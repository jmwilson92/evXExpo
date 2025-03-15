import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDBVOuTPAr3-7PxFdc9T0tG9JDsr9DkjE0",
  authDomain: "evxcharge.firebaseapp.com",
  projectId: "evxcharge",
  storageBucket: "evxcharge.firebasestorage.app",
  messagingSenderId: "414510657046",
  appId: "1:414510657046:web:b6afae8e073f827f240f37",
  measurementId: "G-X8CHDKDBEC"
};

const app = firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
export const db = firebase.firestore();
export const storage = firebase.storage();

export const stripePublishableKey = 'pk_test_51Quzyb01Rp23IMN8OTJtanLBhiFYQZs3qXmx9oPLlGif6K6EsyafdBGqJ8ri4FcjA69j1ok8OBNTZkvb1iGDPe8l00PAy9p6ri';