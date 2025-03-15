const { onDocumentUpdated } = require('firebase-functions/firestore');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51Quzyb01Rp23IMN81Mw8bhA7uI0I0QWiylbNTXBJsGdT4tU1Ff7EgpAVFXEv2F8cP48uhcu3I4EnV7XiU6CS7Lyt000fyzcb3X');

admin.initializeApp();

exports.processCharge = onDocumentUpdated('charges/{chargeId}', async (event) => {
  const data = event.data.after.data();
  const prevData = event.data.before.data();

  // Only process if endTime is set (charge ended)
  if (!prevData.endTime && data.endTime) {
    const { driverId, stationId, startTime, endTime, totalCost } = data;
    const userRef = admin.firestore().collection('users').doc(driverId.split('_')[0]);
    const stationRef = admin.firestore().collection('stations').doc(stationId);

    const [userSnap, stationSnap] = await Promise.all([userRef.get(), stationRef.get()]);
    const user = userSnap.data();
    const station = stationSnap.data();

    if (!user.stripeToken) {
      console.error('No card token for user:', driverId);
      return null;
    }

    const amount = Math.round(totalCost * 100); // Convert to cents
    const platformCut = Math.round(amount * 0.97); // 97%
    const ownerCut = amount - platformCut; // 3%

    try {
      // Charge the driver’s card
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method: user.stripeToken,
        confirmation_method: 'manual',
        confirm: true,
        description: `Charge for ${station.address}`,
      });

      // Transfer to owner (assumes owner has Stripe Connect ID)
      if (station.ownerStripeId) {
        await stripe.transfers.create({
          amount: ownerCut,
          currency: 'usd',
          destination: station.ownerStripeId,
          source_transaction: paymentIntent.charges.data[0].id,
          description: `Owner cut for ${station.address}`,
        });
      }

      console.log('Charge processed:', { driverId, amount, platformCut, ownerCut });
    } catch (error) {
      console.error('Charge failed:', error);
    }
  }
  return null;
});