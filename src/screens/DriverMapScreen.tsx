import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, FlatList, Image, Alert, ScrollView, TextInput, Linking } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import Modal from 'react-native-modal';
import { StackNavigationProp } from '@react-navigation/stack';
import { StackActions } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db, storage, stripePublishableKey } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, updateDoc, query, where, DocumentReference } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { StripeProvider, CardField, useStripe } from '@stripe/stripe-react-native';


type DriverMapScreenNavigationProp = StackNavigationProp<RootStackParamList, 'DriverMapScreen'>;

interface DriverMapScreenProps {
  navigation: DriverMapScreenNavigationProp;
}

interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photo: string | null;
  role: 'Driver' | 'Owner' | 'Both';
  stripeToken?: string;
}

interface StationData {
  id: string;
  chargeRate: string;
  address: string;
  adapterTypes: string[];
  photo: string | null;
  available: boolean;
  latitude: number;
  longitude: number;
  ownerId: string;
  status: 'available' | 'enRoute' | 'charging';
  driverId?: string;
  enRouteTime?: number;
}

interface ChargeSession {
  id: string;
  stationId: string;
  driverId: string;
  startTime: number;
  endTime?: number;
  totalCost?: number;
}

interface MenuOption {
  label: string;
  action: () => void;
}

interface ProfileSectionProps {
  userData: UserData;
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  editedData: UserData;
  setEditedData: (data: UserData) => void;
  onSave: () => void;
  onUploadPhoto: () => void;
}

const MenuModal: React.FC<{ isVisible: boolean; onClose: () => void; options: MenuOption[] }> = ({ isVisible, onClose, options }) => {
  console.log('MenuModal - Rendering with options:', options);
  return (
    <Modal
      isVisible={isVisible}
      onBackdropPress={onClose}
      style={styles.menuModal}
      animationIn="slideInRight"
      animationOut="slideOutRight"
    >
      <View style={[styles.menu, { height: options.length * 60 + 40 }]}>
        {options.map((option, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuItem}
            onPress={() => {
              console.log('Menu option pressed:', option.label);
              option.action();
              onClose();
            }}
          >
            <Text style={styles.menuItemText}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
};

const ProfileSection: React.FC<ProfileSectionProps> = ({
  userData,
  isEditing,
  setIsEditing,
  editedData,
  setEditedData,
  onSave,
  onUploadPhoto,
}) => (
  <ScrollView contentContainerStyle={styles.profileSection}>
    <Text style={styles.sectionTitle}>Profile</Text>
    {userData.photo && (
      <Image source={{ uri: userData.photo }} style={styles.profileImage} />
    )}
    {isEditing && (
      <TouchableOpacity style={styles.uploadButton} onPress={onUploadPhoto}>
        <Text style={styles.buttonText}>Upload Photo</Text>
      </TouchableOpacity>
    )}
    <Text style={styles.label}>Name</Text>
    {isEditing ? (
      <TextInput
        style={styles.input}
        value={`${editedData.firstName} ${editedData.lastName}`}
        onChangeText={(text: string) => {
          const [first, ...last] = text.split(' ');
          setEditedData({ ...editedData, firstName: first || '', lastName: last.join(' ') || '' });
        }}
      />
    ) : (
      <Text style={styles.bubble}>{`${userData.firstName} ${userData.lastName}`}</Text>
    )}
    <Text style={styles.label}>Email</Text>
    {isEditing ? (
      <TextInput
        style={styles.input}
        value={editedData.email}
        onChangeText={(text: string) => setEditedData({ ...editedData, email: text })}
        keyboardType="email-address"
      />
    ) : (
      <Text style={styles.bubble}>{userData.email}</Text>
    )}
    <Text style={styles.label}>Phone</Text>
    {isEditing ? (
      <TextInput
        style={styles.input}
        value={editedData.phone}
        onChangeText={(text: string) => setEditedData({ ...editedData, phone: text })}
        keyboardType="phone-pad"
      />
    ) : (
      <Text style={styles.bubble}>{userData.phone}</Text>
    )}
    <TouchableOpacity
      style={styles.actionButton}
      onPress={() => (isEditing ? onSave() : setIsEditing(true))}
    >
      <Text style={styles.buttonText}>{isEditing ? 'Save' : 'Edit'}</Text>
    </TouchableOpacity>
  </ScrollView>
);

export default function DriverMapScreen({ navigation }: DriverMapScreenProps) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [stations, setStations] = useState<StationData[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState<StationData | null>(null);
  const [isStationModalVisible, setIsStationModalVisible] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<string>('Map');
  const [chargeSession, setChargeSession] = useState<ChargeSession | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<UserData>({} as UserData);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [pastCharges, setPastCharges] = useState<ChargeSession[]>([]);
  const [showCardModal, setShowCardModal] = useState(false);
  const { createPaymentMethod } = useStripe();
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    let unsubscribeStations: () => void;
    let unsubscribeCharges: () => void;
    let locationSubscription: Location.LocationSubscription | null = null;

    const setup = async () => {
      console.log('DriverMap - Setting up');
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('DriverMap - Location permission denied');
        setLoading(false);
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      console.log('DriverMap - Got initial location:', location.coords);
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      locationSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
        (newLocation) => {
          console.log('DriverMap - Location updated:', newLocation.coords);
          setUserLocation({
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
          });
        }
      );

      const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        console.log('DriverMap - Auth state check:', user ? user.uid : 'No user');
        if (user) {
          const userRef = doc(db, 'users', user.uid);
          getDoc(userRef).then(docSnap => {
            if (docSnap.exists()) {
              const data = docSnap.data() as UserData;
              console.log('DriverMap - User role:', data.role);
              setUserData(data);
              setEditedData(data);

              const chargesQuery = query(
                collection(db, 'charges'),
                where('driverId', '==', data.email)
              );
              unsubscribeCharges = onSnapshot(chargesQuery, (snapshot) => {
                const chargeList: ChargeSession[] = snapshot.docs.map(doc => ({
                  id: doc.id,
                  ...doc.data(),
                } as ChargeSession));
                console.log('DriverMap - Past charges updated:', chargeList.length);
                setPastCharges(chargeList);
              }, (error) => console.error('DriverMap - Charges snapshot error:', error));

              unsubscribeStations = onSnapshot(collection(db, 'stations'), (snapshot) => {
                const stationList: StationData[] = snapshot.docs.map(doc => ({
                  id: doc.id,
                  ...doc.data(),
                  status: doc.data().status || 'available',
                } as StationData));
                console.log('DriverMap - Stations updated:', stationList.length);
                setStations(stationList);

                stationList.forEach(station => {
                  if (station.status === 'enRoute' && station.enRouteTime) {
                    const timeElapsed = Date.now() - station.enRouteTime;
                    if (timeElapsed > 15 * 60 * 1000) {
                      resetStation(station);
                    }
                  }
                });
              }, (error) => console.error('DriverMap - Stations snapshot error:', error));

              setLoading(false);
            } else {
              console.log('DriverMap - No user doc, to Signup');
              navigation.navigate('Signup');
            }
          }).catch(error => console.error('DriverMap - Firestore fetch error:', error));
        } else {
          setUserData(null);
          setPastCharges([]);
          setLoading(false);
          if (unsubscribeStations) unsubscribeStations();
          if (unsubscribeCharges) unsubscribeCharges();
          console.log('DriverMap - No user, to Login');
          navigation.navigate('Login');
        }
      });

      return () => unsubscribeAuth();
    };

    setup();

    return () => {
      console.log('DriverMap - Cleanup');
      if (unsubscribeStations) unsubscribeStations();
      if (unsubscribeCharges) unsubscribeCharges();
      if (locationSubscription) locationSubscription.remove();
    };
  }, [navigation]);

  const handleMarkerPress = (station: StationData) => {
    if (mapRef.current) {
      console.log('DriverMap - Marker pressed:', station.id);
      mapRef.current.animateToRegion({
        latitude: station.latitude,
        longitude: station.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  };

  const handleTilePress = (station: StationData) => {
    console.log('DriverMap - Tile pressed:', station.id);
    setSelectedStation(station);
    setIsStationModalVisible(true);
  };

  const handleMapDoublePress = () => {
    if (mapRef.current && userLocation) {
      console.log('DriverMap - Double press, recentering');
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      }, 1000);
    }
  };

  const startNavigation = async () => {
    if (!selectedStation || !userData || !navigation) return;

    const enRouteCount = stations.filter(s => s.status === 'enRoute' && s.driverId === userData.email).length;
    const chargingCount = stations.filter(s => s.status === 'charging' && s.driverId === userData.email).length;
    if (enRouteCount > 0) {
      Alert.alert('Busy', 'You’re already navigating to a station.');
      return;
    }
    if (chargingCount > 0) {
      Alert.alert('Busy', 'You’re already charging at a station.');
      return;
    }

    try {
      console.log('Firestore DB:', db);
      const stationRef: DocumentReference = doc(db, 'stations', selectedStation.id);
      console.log('Station ref path:', stationRef.path);
      await updateDoc(stationRef, {
        status: 'enRoute',
        driverId: userData.email,
        enRouteTime: Date.now(),
      });
      console.log('Navigation set to enRoute');
      setIsStationModalVisible(false);
      handleMarkerPress(selectedStation);

      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedStation.address)}&travelmode=driving`;
      Linking.canOpenURL(url).then(supported => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Alert.alert('Error', 'Cannot open maps—try again.');
          console.log('DriverMap - Cannot open maps URL:', url);
        }
      }).catch(err => console.error('DriverMap - Linking error:', err));
    } catch (error: unknown) {
      console.error('Start navigation error:', error);
      Alert.alert('Error', `Failed to start navigation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetStation = async (station: StationData) => {
    try {
      console.log('Firestore DB:', db);
      const stationRef: DocumentReference = doc(db, 'stations', station.id);
      console.log('Reset station ref path:', stationRef.path);
      await updateDoc(stationRef, {
        status: 'available',
        available: true,
        driverId: null,
        enRouteTime: null,
      });
      console.log('Station reset to available');
      if (chargeSession && chargeSession.stationId === station.id) {
        setChargeSession(null);
      }
      Alert.alert('Station Reset', `${station.address} is now available!`);
    } catch (error: unknown) {
      console.error('Reset station error:', error);
      Alert.alert('Error', `Failed to reset station: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const startCharge = async () => {
    if (!selectedStation || !userData || !userLocation) {
      console.log('startCharge - Missing data:', { selectedStation, userData, userLocation });
      Alert.alert('Error', 'Missing required data');
      return;
    }
  
    const chargingCount = stations.filter(s => s.status === 'charging' && s.driverId === userData.email).length;
    if (chargingCount > 0) {
      console.log('startCharge - Already charging elsewhere');
      Alert.alert('Busy', 'You’re already charging at another station.');
      return;
    }
  
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    console.log('Distance check:', distance);
    if (distance > 0.5) {
      console.log('startCharge - Too far:', distance);
      Alert.alert('Too Far', 'You must be within 0.5 miles to start charging.');
      return;
    }
  
    console.log('Checking stripeToken:', userData.stripeToken);
    if (!userData.stripeToken) {
      console.log('No stripe token, triggering card modal');
      setShowCardModal(true);
      console.log('Modal state set to true, waiting for save');
      return;
    }
  
    try {
      console.log('Firestore DB:', db);
      console.log('Selected station ID:', selectedStation.id);
      const stationRef = db.collection('stations').doc(selectedStation.id);
      console.log('Station ref path:', stationRef.path);
      await stationRef.update({
        status: 'charging',
        available: false,
      });
      console.log('Station updated to charging');
  
      const session: ChargeSession = {
        id: `${userData.email}_${Date.now()}`,
        stationId: selectedStation.id,
        driverId: userData.email,
        startTime: Date.now(),
      };
      const chargeRef = db.collection('charges').doc(session.id);
      console.log('Charge ref path:', chargeRef.path);
      await chargeRef.set(session);
      console.log('Charge session set in Firestore:', session);
  
      setChargeSession(session);
      console.log('Charge session set locally:', session);
      setCurrentScreen('Charges');
      console.log('Screen set to Charges');
    } catch (error: unknown) {
      console.error('startCharge error:', error);
      Alert.alert('Error', `Failed to start charge: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCardSubmit = async () => {
    if (!userData || !auth.currentUser) {
      console.log('handleCardSubmit - Missing user data or auth');
      Alert.alert('Error', 'No user data available');
      return;
    }
  
    if (!showCardModal) {
      console.log('handleCardSubmit - Modal already closed, aborting');
      return;
    }
  
    try {
      console.log('Starting card submit, user:', auth.currentUser.uid);
      const { paymentMethod, error } = await createPaymentMethod({
        paymentMethodType: 'Card',
      });
  
      if (error) {
        console.log('Stripe error:', error.message);
        Alert.alert('Error', error.message);
        return;
      }
  
      if (!paymentMethod) {
        console.log('No payment method returned');
        Alert.alert('Error', 'No payment method created');
        return;
      }
  
      console.log('Payment method created:', paymentMethod.id);
      const userRef = db.collection('users').doc(auth.currentUser.uid);
      console.log('User ref path:', userRef.path);
      await userRef.update({
        stripeToken: paymentMethod.id,
      });
      console.log('Stripe token updated in Firestore');
      const updatedUserData = { ...userData, stripeToken: paymentMethod.id };
      setUserData(updatedUserData);
      console.log('User data updated locally:', updatedUserData);
  
      setShowCardModal(false);
      console.log('Card modal set to false');
  
      setTimeout(() => {
        if (showCardModal) {
          console.log('Modal still open, forcing close');
          setShowCardModal(false);
        }
      }, 100);
  
      console.log('Calling startCharge');
      await startCharge();
      console.log('startCharge completed successfully');
    } catch (error: unknown) {
      console.error('Card submit error:', error);
      Alert.alert('Error', `Failed to save card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const endCharge = async () => {
    if (!selectedStation || !chargeSession || !userData) {
      console.log('DriverMap - End charge failed: Missing data', { selectedStation, chargeSession, userData });
      Alert.alert('Error', 'Cannot end charge—missing data. Try again.');
      return;
    }
    const endTime = Date.now();
    const minutes = (endTime - chargeSession.startTime) / (1000 * 60);
    const rate = parseFloat(selectedStation.chargeRate);
    const totalCost = minutes * rate;

    try {
      console.log('Firestore DB:', db);
      const stationRef: DocumentReference = doc(db, 'stations', selectedStation.id);
      console.log('Station ref path:', stationRef.path);
      await updateDoc(stationRef, {
        status: 'available',
        available: true,
        driverId: null,
        enRouteTime: null,
      });
      console.log('Station set to available');

      const chargeRef: DocumentReference = doc(db, 'charges', chargeSession.id);
      console.log('Charge ref path:', chargeRef.path);
      await updateDoc(chargeRef, {
        endTime,
        totalCost,
      });
      console.log('Charge session ended');

      Alert.alert('Charge Complete', `Total Cost: $${totalCost.toFixed(2)} for ${minutes.toFixed(2)} minutes`);
      setChargeSession(null);
      setSelectedStation(null);
      setCurrentScreen('Map');
    } catch (error: unknown) {
      console.error('End charge error:', error);
      Alert.alert('Error', `Failed to end charge: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSaveProfile = async () => {
    const user = auth.currentUser;
    if (user) {
      console.log('DriverMap - Saving profile for:', user.uid);
      await setDoc(doc(db, 'users', user.uid), editedData, { merge: true });
      setUserData(editedData);
      setIsEditing(false);
      Alert.alert('Success', 'Profile Updated!');
    }
  };

  const handleUploadPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need permission to access your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const user = auth.currentUser;
      if (user) {
        const photoRef = ref(storage, `profile_photos/${user.uid}`);
        const response = await fetch(uri);
        const blob = await response.blob();
        await uploadBytes(photoRef, blob);
        const photoURL = await getDownloadURL(photoRef);
        setEditedData({ ...editedData, photo: photoURL });
        console.log('DriverMap - Photo uploaded:', photoURL);
      }
    }
  };

  const handleSignOut = async () => {
    console.log('DriverMap - Signing out');
    try {
      await auth.signOut();
      console.log('DriverMap - Signed out successfully');
    } catch (error) {
      console.error('DriverMap - Sign out error:', error);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in miles
  };

  const filteredStations = useMemo(() => {
    if (!filterType) return stations;
    return stations.filter(station => station.adapterTypes.includes(filterType));
  }, [stations, filterType]);

  const nearbyStations = useMemo(() => {
    if (!userLocation) return filteredStations;
    return filteredStations.filter(station => {
      const distance = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        station.latitude,
        station.longitude
      );
      return distance <= 7; // Within 7 miles
    });
  }, [filteredStations, userLocation]);

  const sortedStations = useMemo(() => {
    if (!userLocation) return nearbyStations;
    return [...nearbyStations].sort((a, b) => {
      const distA = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        a.latitude,
        a.longitude
      );
      const distB = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        b.latitude,
        b.longitude
      );
      return distA - distB; // Closest first
    });
  }, [nearbyStations, userLocation]);

  const totalSpent = useMemo(() => {
    return pastCharges.reduce((sum, charge) => sum + (charge.totalCost || 0), 0).toFixed(2);
  }, [pastCharges]);

  const getTileBackgroundColor = (station: StationData) => {
    switch (station.status) {
      case 'enRoute': return '#FFFF00'; // Yellow
      case 'charging': return '#FF0000'; // Red
      case 'available': return '#00FF00'; // Green
      default: return '#FFFFFF'; // White fallback
    }
  };

  const renderStationTile = ({ item }: { item: StationData }) => (
    <TouchableOpacity 
      style={[styles.tile, { backgroundColor: getTileBackgroundColor(item) }]} 
      onPress={() => handleTilePress(item)}
    >
      {item.photo ? (
        <Image source={{ uri: item.photo }} style={styles.tileImage} />
      ) : (
        <View style={styles.noImage}>
          <Text style={styles.tileText}>No Photo</Text>
        </View>
      )}
      <View style={styles.tileTextContainer}>
        <Text style={styles.tileText}>${item.chargeRate} Per Minute💵</Text>
        <Text style={styles.tileText}>{item.adapterTypes.join(', ')}</Text>
        <Text style={styles.tileText}>{item.available ? 'Available' : 'In Use'}</Text>
        {userLocation && (
          <Text style={styles.tileText}>
            {calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(1)} mi
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderChargeItem = ({ item }: { item: ChargeSession }) => {
    const station = stations.find(s => s.id === item.stationId);
    const minutes = item.endTime && item.startTime ? ((item.endTime - item.startTime) / (1000 * 60)).toFixed(2) : 'N/A';
    return (
      <View style={styles.chargeCard}>
        <Text style={styles.chargeCardText}>{station ? station.address : 'Unknown Station'}</Text>
        <Text style={styles.chargeCardText}>Rate: ${station ? station.chargeRate : 'N/A'}/min</Text>
        <Text style={styles.chargeCardText}>Duration: {minutes} min</Text>
        <Text style={styles.chargeCardText}>Cost: ${item.totalCost ? item.totalCost.toFixed(2) : 'N/A'}</Text>
      </View>
    );
  };

  const getPinColor = (station: StationData) => {
    switch (station.status) {
      case 'enRoute': return 'yellow';
      case 'charging': return 'red';
      case 'available': return 'green';
      default: return 'green';
    }
  };

  const menuOptions = useMemo(() => {
    const baseOptions: MenuOption[] = [
      { label: 'Map', action: () => setCurrentScreen('Map') },
      { label: 'Profile', action: () => setCurrentScreen('Profile') },
      { label: 'Charges', action: () => setCurrentScreen('Charges') },
      { label: 'Sign Out', action: () => handleSignOut() },
    ];

    if (userData?.role === 'Both') {
      baseOptions.splice(3, 0, {
        label: 'Owner Dash',
        action: () => {
          console.log('DriverMap - Navigating to OwnerDash');
          navigation.dispatch(StackActions.replace('OwnerDash'));
          console.log('DriverMap - Navigation dispatched');
        },
      });
    }

    return baseOptions;
  }, [userData, navigation]);

  const renderScreen = () => {
    console.log('DriverMap - Rendering screen:', currentScreen, { chargeSession, selectedStation });
    if (!userData) return null;
    switch (currentScreen) {
      case 'Profile':
        return (
          <ProfileSection
            userData={userData}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            editedData={editedData}
            setEditedData={setEditedData}
            onSave={handleSaveProfile}
            onUploadPhoto={handleUploadPhoto}
          />
        );
      case 'Charges':
        return (
          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Charges</Text>
            <Text style={styles.totalSpent}>Total Spent: ${totalSpent}</Text>
            {stations.some(s => s.status === 'enRoute' && s.driverId === userData.email) && (
              <View style={styles.chargeControl}>
                <Text style={styles.chargeCardText}>Navigating to: {stations.find(s => s.status === 'enRoute' && s.driverId === userData.email)?.address || 'Unknown'}</Text>
                <Text style={styles.chargeCardText}>Rate: ${stations.find(s => s.status === 'enRoute' && s.driverId === userData.email)?.chargeRate || 'N/A'}/min</Text>
                <TouchableOpacity 
                  style={styles.actionButton} 
                  onPress={() => {
                    const enRouteStation = stations.find(s => s.status === 'enRoute' && s.driverId === userData.email);
                    if (enRouteStation) {
                      setSelectedStation(enRouteStation);
                      startCharge();
                    }
                  }}
                >
                  <Text style={styles.buttonText}>Start Charge</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.cancelButton} 
                  onPress={() => {
                    const enRouteStation = stations.find(s => s.status === 'enRoute' && s.driverId === userData.email);
                    if (enRouteStation) {
                      resetStation(enRouteStation);
                    }
                  }}
                >
                  <Text style={styles.buttonText}>Cancel Navigation</Text>
                </TouchableOpacity>
              </View>
            )}
            {chargeSession && selectedStation && (
              <View style={styles.chargeControl}>
                <Text style={styles.chargeCardText}>Charging at: {selectedStation.address}</Text>
                <Text style={styles.chargeCardText}>Rate: ${selectedStation.chargeRate}/min</Text>
                <Text style={styles.chargeCardText}>Started: {new Date(chargeSession.startTime).toLocaleTimeString()}</Text>
                <TouchableOpacity 
                  style={styles.actionButton} 
                  onPress={endCharge}
                >
                  <Text style={styles.buttonText}>End Charge</Text>
                </TouchableOpacity>
              </View>
            )}
            <FlatList
              data={pastCharges}
              renderItem={renderChargeItem}
              keyExtractor={item => item.id}
              ListEmptyComponent={<Text style={styles.noChargesText}>No past charges yet, bruh!</Text>}
              contentContainerStyle={styles.chargesList}
            />
          </View>
        );
      case 'Map':
      default:
        return (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={
                userLocation ? {
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                } : {
                  latitude: 37.78825,
                  longitude: -122.4324,
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                }
              }
              onDoublePress={handleMapDoublePress}
            >
              {sortedStations.map(station => (
                <Marker
                  key={station.id}
                  coordinate={{ latitude: station.latitude, longitude: station.longitude }}
                  title={station.address}
                  description={`${station.chargeRate} kW - ${station.adapterTypes.join(', ')}`}
                  onPress={() => handleMarkerPress(station)}
                  pinColor={getPinColor(station)}
                />
              ))}
              {userLocation && (
                <Marker
                  key="userLocation"
                  coordinate={{ latitude: userLocation.latitude, longitude: userLocation.longitude }}
                  title="You"
                  pinColor="blue"
                />
              )}
            </MapView>
            {userData?.photo && (
              <Image source={{ uri: userData.photo }} style={styles.profilePic} />
            )}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={[styles.filterButton, filterType === null && styles.filterButtonSelected]}
                onPress={() => setFilterType(null)}
              >
                <Text style={styles.filterText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, filterType === 'NACS' && styles.filterButtonSelected]}
                onPress={() => setFilterType('NACS')}
              >
                <Text style={styles.filterText}>NACS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, filterType === 'CCS' && styles.filterButtonSelected]}
                onPress={() => setFilterType('CCS')}
              >
                <Text style={styles.filterText}>CCS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, filterType === 'CHAdeMO' && styles.filterButtonSelected]}
                onPress={() => setFilterType('CHAdeMO')}
              >
                <Text style={styles.filterText}>CHAdeMO</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tileContainer}>
              <FlatList
                data={sortedStations}
                renderItem={renderStationTile}
                keyExtractor={item => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tileList}
              />
            </View>
          </>
        );
    }
  };

  console.log('DriverMapScreen - Rendering, loading:', loading, 'userLocation:', !!userLocation);
  if (loading || !userLocation) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <StripeProvider publishableKey={stripePublishableKey}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.menuButton} onPress={() => setIsMenuVisible(true)}>
          <Text style={styles.menuText}>☰</Text>
        </TouchableOpacity>
        {renderScreen()}
        <Modal isVisible={isStationModalVisible} onBackdropPress={() => setIsStationModalVisible(false)}>
          <View style={styles.modalContent}>
            {selectedStation && (
              <>
                <Text style={styles.modalTitle}>{selectedStation.address}</Text>
                {selectedStation.photo && (
                  <Image source={{ uri: selectedStation.photo }} style={styles.modalImage} />
                )}
                <Text style={styles.chargeCardText}>{selectedStation.chargeRate} kW</Text>
                <Text style={styles.chargeCardText}>{selectedStation.adapterTypes.join(', ')}</Text>
                <Text style={styles.chargeCardText}>{selectedStation.available ? 'Available' : 'In Use'}</Text>
                {selectedStation.available && (
                  <TouchableOpacity style={styles.modalButton} onPress={startNavigation}>
                    <Text style={styles.buttonText}>Navigate to Station</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </Modal>
        <MenuModal isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)} options={menuOptions} />
        <Modal isVisible={showCardModal} onBackdropPress={() => setShowCardModal(false)}>
          <View style={styles.cardModalContent}>
            <Text style={styles.modalTitle}>Enter Card Details</Text>
            <CardField
              postalCodeEnabled={true}
              placeholders={{ number: '4242 4242 4242 4242' }}
              cardStyle={{
                backgroundColor: '#FFFFFF',
                textColor: '#000000',
              }}
              style={{
                width: '100%',
                height: 50,
                marginVertical: 30,
              }}
            />
            <TouchableOpacity style={styles.modalButton} onPress={handleCardSubmit}>
              <Text style={styles.buttonText}>Save Card</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    </StripeProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e6f0ff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  map: { 
    width: Dimensions.get('window').width, 
    height: Dimensions.get('window').height, 
  },
  menuButton: { 
    position: 'absolute', 
    top: 60, 
    right: 20, 
    padding: 10, 
    zIndex: 20, 
    backgroundColor: '#fff', 
    borderRadius: 5,
  },
  menuText: { fontSize: 24, color: '#1E90FF' },
  profilePic: {
    position: 'absolute',
    top: 60,
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    zIndex: 20,
  },
  filterContainer: {
    position: 'absolute',
    top: 120,
    left: 20,
    flexDirection: 'column',
    zIndex: 20,
  },
  filterButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginVertical: 5,
  },
  filterButtonSelected: {
    backgroundColor: '#1E90FF',
  },
  filterText: {
    fontSize: 12,
    color: '#333',
  },
  tileContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  tileList: {
    paddingHorizontal: 10,
  },
  tile: {
    borderRadius: 10,
    marginRight: 10,
    padding: 5,
    width: 110,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  tileImage: {
    width: 100,
    height: 100,
    borderRadius: 5,
  },
  noImage: {
    width: 100,
    height: 100,
    borderRadius: 5,
    backgroundColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileTextContainer: {
    marginTop: 2,
    alignItems: 'center',
  },
  tileText: {
    fontSize: 10,
    color: '#333',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    width: '80%',
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  modalImage: {
    width: 150,
    height: 150,
    borderRadius: 10,
    marginBottom: 10,
  },
  modalButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  menuModal: { 
    margin: 0, 
    justifyContent: 'flex-end', 
    alignItems: 'flex-end',
    paddingTop: 60, 
  },
  menu: {
    width: '50%',
    backgroundColor: '#fff',
    padding: 10,
    borderTopLeftRadius: 15,
    borderBottomLeftRadius: 15,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  menuItem: { 
    paddingVertical: 15 
  },
  menuItemText: { 
    fontSize: 18, 
    color: '#333' 
  },
  content: { 
    flex: 1, 
    padding: 20, 
    paddingTop: 100 
  },
  sectionTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#1E90FF', 
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  totalSpent: {
    fontSize: 16,
    color: '#333',
    marginTop: 10,
    marginBottom: 20,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  chargeControl: { 
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },
  chargesList: {
    paddingBottom: 20,
  },
  chargeCard: {
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },
  chargeCardText: {
    fontSize: 14,
    color: '#333',
    marginVertical: 2,
  },
  noChargesText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
  },
  actionButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 20,
  },
  cancelButton: {
    backgroundColor: '#FF4444',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 10,
  },
  resetButton: {
    backgroundColor: '#FF4444',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 10,
  },
  profileSection: { 
    width: '100%', 
    padding: 20, 
    alignItems: 'center', 
    paddingTop: 80 
  },
  label: { 
    fontSize: 16, 
    color: '#666', 
    alignSelf: 'flex-start', 
    marginTop: 10 
  },
  bubble: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 10,
    width: '100%',
    backgroundColor: '#fff',
    marginVertical: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 10,
    width: '100%',
    backgroundColor: '#fff',
    marginVertical: 5,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 20,
  },
  uploadButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginBottom: 20,
  },
  cardModalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    width: '90%',
    alignSelf: 'center',
  },
});