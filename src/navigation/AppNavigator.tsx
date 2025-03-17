// AppNavigator.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { auth, db } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
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
  OwnerDashScreen: undefined; // Already updated
};

export default function AppNavigator() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRef = db.collection('users').doc(user.uid);
        const docSnap = await userRef.get();
        if (docSnap.exists) { // Changed from docSnap.exists() to docSnap.exists
          const data = docSnap.data() as { role: 'Driver' | 'Owner' | 'Both' };
          console.log('AppNavigator - User role:', data.role);
          setInitialRoute(data.role === 'Both' || data.role === 'Owner' ? 'OwnerDashScreen' : 'DriverMapScreen');
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
        <Stack.Screen name="OwnerDashScreen" component={OwnerDashScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}