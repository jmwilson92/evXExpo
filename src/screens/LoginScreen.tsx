import React, { useState } from 'react';
import { View, TextInput, Button, Alert, StyleSheet, ImageBackground, Text, Image, TouchableOpacity } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { StackActions } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db } from '../../firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

interface Props {
  navigation: LoginScreenNavigationProp;
}

const LoginScreen = ({ navigation }: Props) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = async () => {
    console.log('Login - Attempting sign-in with:', email);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('Login - Signed in:', userCredential.user.uid);
      const userRef = db.collection('users').doc(userCredential.user.uid);
      const docSnap = await userRef.get();
      if (docSnap.exists) {
        const data = docSnap.data() as { role: 'Driver' | 'Owner' | 'Both' };
        console.log('Login - User role:', data.role);
        const targetScreen = data.role === 'Both' || data.role === 'Owner' ? 'OwnerDashScreen' : 'DriverMapScreen';
        console.log('Login - Forcing nav to:', targetScreen);
        navigation.dispatch(StackActions.replace(targetScreen));
      } else {
        navigation.navigate('Signup');
      }
    } catch (error) {
      console.error('Login - Sign-in error:', error);
      Alert.alert('Error', 'Failed to sign in: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  return (
    <ImageBackground source={require('../../assets/logo.png')} style={styles.background}>
      <View style={styles.overlay}>
        <Text style={styles.title}>EVX Login</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Button title="Sign In" onPress={handleSignIn} color="#1E90FF" />
          <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
            <Text style={styles.signupLink}>Create an account here</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)', // Semi-transparent overlay for readability
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 30,
    textAlign: 'center',
  },
  inputContainer: {
    width: '80%',
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Slightly transparent white background for inputs
    padding: 20,
    borderRadius: 10,
    elevation: 5, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  input: {
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    marginBottom: 15,
    backgroundColor: '#fff',
    color: '#000',
    fontSize: 16,
  },
  signupLink: {
    marginTop: 15,
    color: '#1E90FF', // Matches the app's primary color
    fontSize: 16,
    textAlign: 'center',
    textDecorationLine: 'underline', // Makes it look like a clickable link
  },
});

export default LoginScreen;