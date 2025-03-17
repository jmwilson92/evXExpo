const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/firestore');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51Quzyb01Rp23IMN81Mw8bhA7uI0I0QWiylbNTXBJsGdT4tU1Ff7EgpAVFXEv2F8cP48uhcu3I4EnV7XiU6CS7Lyt000fyzcb3X');

admin.initializeApp();

exports.startChargeProcess = onDocumentCreated('charges/{chargeId}', async (snap, context) => {
  const data = snap.data();
  const { driverId, stationId, startTime } = data;
  const userRef = admin.firestore().collection('users').doc(driverId.split('_')[0]); // Adjust if driverId format changes
  const userSnap = await userRef.get();
  const user = userSnap.data();

  if (!user || !user.stripeToken) {
    console.error('No user or stripeToken found for:', driverId);
    await snap.ref.update({ status: 'failed', error: 'No payment method' });
    return null;
  }

  try {
    // Create a payment intent for the start of the charge (initial authorization)
    // Using a minimum amount for authorization (e.g., $1.00), adjust as needed
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100, // $1.00 in cents, placeholder; update with dynamic logic if needed
      currency: 'usd',
      payment_method: user.stripeToken,
      confirmation_method: 'manual',
      confirm: true,
      description: `Charge authorization for ${stationId}`,
    });

    await snap.ref.update({
      paymentIntentId: paymentIntent.id,
      status: 'authorized', // Indicate payment is authorized
    });
    console.log('Charge authorized:', { driverId, paymentIntentId: paymentIntent.id });
  } catch (error) {
    console.error('Failed to authorize charge:', error);
    await snap.ref.update({
      status: 'failed',
      error: error.message,
    });
  }
  return null;
});

exports.processCharge = onDocumentUpdated('charges/{chargeId}', async (event) => {
  const data = event.data.after.data();
  const prevData = event.data.before.data();

  // Only process if endTime is set (charge ended)
  if (!prevData.endTime && data.endTime) {
    const { driverId, stationId, startTime, endTime, totalCost, paymentIntentId } = data;
    const userRef = admin.firestore().collection('users').doc(driverId.split('_')[0]); // Adjust if driverId format changes
    const stationRef = admin.firestore().collection('stations').doc(stationId);

    const [userSnap, stationSnap] = await Promise.all([userRef.get(), stationRef.get()]);
    const user = userSnap.data();
    const station = stationSnap.data();

    if (!user.stripeToken || !paymentIntentId) {
      console.error('No card token or payment intent for user:', driverId);
      await event.data.after.ref.update({ status: 'failed', error: 'Missing payment details' });
      return null;
    }

    const amount = Math.round(totalCost * 100); // Convert to cents
    const platformCut = Math.round(amount * 0.05); // 5% to platform
    const ownerCut = amount - platformCut; // 95% to owner

    try {
      // Finalize the payment intent with the actual amount
      const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
        amount,
      });
      await stripe.paymentIntents.confirm(paymentIntentId);

      // Transfer to owner (assumes owner has Stripe Connect ID)
      if (station && station.ownerStripeId) {
        await stripe.transfers.create({
          amount: ownerCut,
          currency: 'usd',
          destination: station.ownerStripeId,
          source_transaction: paymentIntent.charges.data[0].id,
          description: `Owner cut for ${station.address}`,
        });
      } else {
        console.log('No ownerStripeId, skipping transfer');
      }

      await event.data.after.ref.update({ status: 'completed' });
      console.log('Charge processed:', { driverId, amount, platformCut, ownerCut });
    } catch (error) {
      console.error('Charge failed:', error);
      await event.data.after.ref.update({ status: 'failed', error: error.message });
    }
  }
  return null;
});