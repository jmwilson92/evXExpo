import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ImageBackground } from 'react-native';
import { auth, db } from '../../firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';

type SignupScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Signup'>;

interface SignupScreenProps {
  navigation: SignupScreenNavigationProp;
}

export default function SignupScreen({ navigation }: SignupScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'Driver' | 'Owner' | 'Both'>('Driver');

  const handleSignup = () => {
    console.log('Signup - Attempting with:', email, 'Role:', role);
    createUserWithEmailAndPassword(auth, email, password)
      .then(userCredential => {
        const user = userCredential.user;
        console.log('Signup - User created:', user.uid);
        return setDoc(doc(db, 'users', user.uid), {
          firstName,
          lastName,
          email,
          phone,
          role, // Selected role
        }).then(() => {
          console.log('Signup - User data saved');
          const route = role === 'Driver' ? 'DriverMapScreen' : 'OwnerDash'; // Owner or Both go to OwnerDash
          console.log('Signup - Forcing nav to:', route);
          navigation.replace(route);
        });
      })
      .catch(error => {
        console.error('Signup - Error:', error.message);
        alert(error.message);
      });
  };

  console.log('SignupScreen - Rendering');
  return (
    <ImageBackground source={require('../../assets/logo.png')} style={styles.background}>
      <View style={styles.container}>
        <Text style={styles.title}>Sign Up</Text>
        <TextInput
          style={styles.input}
          placeholder="First Name"
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={styles.input}
          placeholder="Last Name"
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Text style={styles.roleLabel}>Select Role:</Text>
        <View style={styles.roleContainer}>
          <TouchableOpacity
            style={[styles.roleButton, role === 'Driver' && styles.roleButtonSelected]}
            onPress={() => setRole('Driver')}
          >
            <Text style={styles.roleText}>Driver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, role === 'Owner' && styles.roleButtonSelected]}
            onPress={() => setRole('Owner')}
          >
            <Text style={styles.roleText}>Owner</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, role === 'Both' && styles.roleButtonSelected]}
            onPress={() => setRole('Both')}
          >
            <Text style={styles.roleText}>Both</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.button} onPress={handleSignup}>
          <Text style={styles.buttonText}>Sign Up</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.link}>Already have an account? Log In</Text>
        </TouchableOpacity>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  input: {
    width: '80%',
    padding: 15,
    marginVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  roleLabel: {
    fontSize: 16,
    color: '#333',
    marginTop: 10,
    marginBottom: 5,
  },
  roleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    marginVertical: 10,
  },
  roleButton: {
    flex: 1,
    padding: 10,
    marginHorizontal: 5,
    backgroundColor: '#fff',
    borderRadius: 10,
    alignItems: 'center',
  },
  roleButtonSelected: {
    backgroundColor: '#1E90FF',
  },
  roleText: {
    fontSize: 14,
    color: '#333',
  },
  button: {
    backgroundColor: '#1E90FF',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  link: {
    color: '#1E90FF',
    marginTop: 15,
  },
});

function alert(message: any) {
  throw new Error('Function not implemented.');
}