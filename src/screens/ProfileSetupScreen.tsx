import React, { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

const ProfileSetupScreen = ({ navigation }: any) => {
  const [role, setRole] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick Your Role</Text>
      <Button
        title="Driver"
        onPress={() => {
          setRole('driver');
          navigation.navigate('DriverMap');
        }}
      />
      <Button
        title="Charging Station Owner"
        onPress={() => {
          setRole('owner');
          navigation.navigate('OwnerProfile');
        }}
      />
      <Button
        title="Both"
        onPress={() => {
          setRole('both');
          navigation.navigate('DriverMap');
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 20 },
});

export default ProfileSetupScreen;