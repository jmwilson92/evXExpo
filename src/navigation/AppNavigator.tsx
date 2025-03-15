// AppNavigator.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { auth, db } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import LoginScreen from '../screens/LoginScreen'; // Adjust path
import SignupScreen from '../screens/SignupScreen'; // Adjust path
import DriverMapScreen from '../screens/DriverMapScreen';
import OwnerDashScreen from '../screens/OwnerDashScreen';
import { Text, View } from 'react-native';

const Stack = createStackNavigator();
export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  DriverMapScreen: undefined;
  OwnerDash: undefined;
};

export default function AppNavigator() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as { role: 'Driver' | 'Owner' | 'Both' };
          console.log('AppNavigator - User role:', data.role);
          setInitialRoute(data.role === 'Both' || data.role === 'Owner' ? 'OwnerDash' : 'DriverMapScreen');
        } else {
          setInitialRoute('Signup');
        }
      } else {
        setInitialRoute('Login');
      }
    });

    return () => unsubscribe();
  }, []);

  if (initialRoute === null) {
    return <View><Text>Loading...</Text></View>; // Splash while checking auth
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
        <Stack.Screen name="DriverMapScreen" component={DriverMapScreen} options={{ headerShown: false }} />
        <Stack.Screen name="OwnerDash" component={OwnerDashScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}