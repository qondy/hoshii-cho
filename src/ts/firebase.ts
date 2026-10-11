import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyBngBgclP3xk4zrceTvi3QGKF7JJ4wlTRA',
  authDomain: 'hoshii-cho.firebaseapp.com',
  projectId: 'hoshii-cho',
  storageBucket: 'hoshii-cho.firebasestorage.app',
  messagingSenderId: '539786573384',
  appId: '1:539786573384:web:2c3cfa766fe1e11d6bca7d',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
