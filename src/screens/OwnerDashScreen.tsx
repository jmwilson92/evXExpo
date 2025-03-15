import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ScrollView, Alert, FlatList } from 'react-native';
import Modal from 'react-native-modal';
import { StackNavigationProp } from '@react-navigation/stack';
import { StackActions } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { auth, db, storage } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, collection, onSnapshot, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

type OwnerDashScreenNavigationProp = StackNavigationProp<RootStackParamList, 'OwnerDash'>;

interface MenuOption { label: string; action: () => void; }
interface UserData { firstName: string; lastName: string; email: string; phone: string; photo: string | null; role: 'Driver' | 'Owner' | 'Both'; }
interface StationData { id: string; chargeRate: string; address: string; adapterTypes: string[]; photo: string | null; available: boolean; latitude: number; longitude: number; ownerId: string; }
interface AddressSuggestion { name: string; latitude: number; longitude: number; }

interface MenuModalProps { isVisible: boolean; onClose: () => void; options: MenuOption[]; }
interface ProfileSectionProps { userData: UserData; isEditing: boolean; setIsEditing: (value: boolean) => void; editedData: UserData; setEditedData: (data: UserData) => void; onSave: () => void; }
interface AddStationModalProps { isVisible: boolean; onClose: () => void; stationData: StationData; setStationData: (data: StationData) => void; onSave: () => void; }

const MenuModal: React.FC<MenuModalProps> = ({ isVisible, onClose, options }) => {
  console.log('Rendering MenuModal with options:', options);
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

const ProfileSection: React.FC<ProfileSectionProps> = ({ userData, isEditing, setIsEditing, editedData, setEditedData, onSave }) => (
  <ScrollView contentContainerStyle={styles.profileSection}>
    <Text style={styles.sectionTitle}>Profile</Text>
    <Text style={styles.label}>Name</Text>
    {isEditing ? (
      <TextInput style={styles.input} value={`${editedData.firstName} ${editedData.lastName}`} onChangeText={(text: string) => { const [first, ...last] = text.split(' '); setEditedData({ ...editedData, firstName: first || '', lastName: last.join(' ') || '' }); }} />
    ) : (
      <Text style={styles.bubble}>{`${userData.firstName} ${userData.lastName}`}</Text>
    )}
    <Text style={styles.label}>Email</Text>
    {isEditing ? (
      <TextInput style={styles.input} value={editedData.email} onChangeText={(text: string) => setEditedData({ ...editedData, email: text })} keyboardType="email-address" />
    ) : (
      <Text style={styles.bubble}>{userData.email}</Text>
    )}
    <Text style={styles.label}>Phone</Text>
    {isEditing ? (
      <TextInput style={styles.input} value={editedData.phone} onChangeText={(text: string) => setEditedData({ ...editedData, phone: text })} keyboardType="phone-pad" />
    ) : (
      <Text style={styles.bubble}>{userData.phone}</Text>
    )}
    <TouchableOpacity style={styles.actionButton} onPress={() => (isEditing ? onSave() : setIsEditing(true))}>
      <Text style={styles.buttonText}>{isEditing ? 'Save' : 'Edit'}</Text>
    </TouchableOpacity>
  </ScrollView>
);

const AddStationModal: React.FC<AddStationModalProps> = ({ isVisible, onClose, stationData, setStationData, onSave }) => {
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const adapterOptions = ['NACS', 'CCS', 'CHAdeMO'];

  const handleAddressChange = async (text: string) => {
    setStationData({ ...stationData, address: text });
    if (text.length > 3) {
      try {
        const coords = await Location.geocodeAsync(text);
        const suggestionsPromises = coords.map(async (coord) => {
          const reverseResults = await Location.reverseGeocodeAsync({ latitude: coord.latitude, longitude: coord.longitude });
          const result = reverseResults[0];
          return { name: `${result.street || ''} ${result.streetNumber || ''}, ${result.city || ''}, ${result.region || ''}, ${result.country || ''}`.trim(), latitude: coord.latitude, longitude: coord.longitude };
        });
        const suggestions = await Promise.all(suggestionsPromises);
        setAddressSuggestions(suggestions.filter(s => s.name).slice(0, 5));
      } catch (error) {
        console.log('Address suggestion error:', error);
      }
    } else {
      setAddressSuggestions([]);
    }
  };

  const selectAddress = (suggestion: AddressSuggestion) => {
    setStationData({ ...stationData, address: suggestion.name, latitude: suggestion.latitude, longitude: suggestion.longitude });
    setAddressSuggestions([]);
  };

  const toggleAdapterType = (type: string) => {
    const currentTypes = stationData.adapterTypes || [];
    if (currentTypes.includes(type)) {
      setStationData({ ...stationData, adapterTypes: currentTypes.filter(t => t !== type) });
    } else {
      setStationData({ ...stationData, adapterTypes: [...currentTypes, type] });
    }
  };

  return (
    <Modal isVisible={isVisible} onBackdropPress={onClose} style={styles.centeredModal}>
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>Add New Station</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Charge Rate ($ per minute)" // Updated placeholder
          value={stationData.chargeRate} 
          onChangeText={(text: string) => setStationData({ ...stationData, chargeRate: text })} 
          keyboardType="numeric" 
        />
        <TextInput style={styles.input} placeholder="Station Address" value={stationData.address} onChangeText={handleAddressChange} />
        {addressSuggestions.length > 0 && (
          <FlatList
            data={addressSuggestions}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.suggestionItem} onPress={() => selectAddress(item)}>
                <Text>{item.name}</Text>
              </TouchableOpacity>
            )}
            keyExtractor={(item, index) => index.toString()}
            style={styles.suggestionList}
          />
        )}
        <Text style={styles.label}>Adapter Types</Text>
        <View style={styles.adapterContainer}>
          {adapterOptions.map(type => (
            <TouchableOpacity key={type} style={[styles.adapterButton, stationData.adapterTypes?.includes(type) && styles.adapterButtonSelected]} onPress={() => toggleAdapterType(type)}>
              <Text style={styles.adapterText}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {stationData.photo && <Image source={{ uri: stationData.photo }} style={styles.stationPhoto} />}
        <TouchableOpacity style={styles.actionButton} onPress={async () => {
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
          if (!result.canceled && result.assets[0].uri) setStationData({ ...stationData, photo: result.assets[0].uri });
        }}>
          <Text style={styles.buttonText}>{stationData.photo ? 'Change Photo' : 'Upload Photo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={onSave}>
          <Text style={styles.buttonText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

interface OwnerDashScreenProps { navigation: OwnerDashScreenNavigationProp; }

export default function OwnerDashScreen({ navigation }: OwnerDashScreenProps): JSX.Element {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<string>('Dashboard');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<UserData>({} as UserData);
  const [isAddStationModalVisible, setIsAddStationModalVisible] = useState(false);
  const [stationData, setStationData] = useState<StationData>({ id: '', chargeRate: '', address: '', adapterTypes: [], photo: null, available: true, latitude: 0, longitude: 0, ownerId: '' });
  const [stations, setStations] = useState<StationData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('OwnerDashScreen mounted');
    let unsubscribeStations: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      console.log('OwnerDash - Auth state check:', user ? user.uid : 'No user');
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        getDoc(userRef).then(docSnap => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserData;
            console.log('OwnerDash - User role:', data.role);
            setUserData(data);
            setEditedData(data);
          } else {
            navigation.navigate('Signup');
          }
        }).catch(error => console.error('Firestore fetch error:', error));

        unsubscribeStations = onSnapshot(collection(db, 'stations'), (snapshot) => {
          const stationList: StationData[] = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as StationData))
            .filter(station => station.ownerId === user.uid);
          setStations(stationList);
        }, (error) => console.error('Stations snapshot error:', error));

        setLoading(false);
      } else {
        setUserData(null);
        setLoading(false);
        if (unsubscribeStations) unsubscribeStations();
        navigation.navigate('Login');
      }
    });

    return () => {
      console.log('OwnerDashScreen unmounting');
      unsubscribeAuth();
      if (unsubscribeStations) unsubscribeStations();
    };
  }, [navigation]);

  const menuOptions: MenuOption[] = [
    { label: 'Profile', action: () => setCurrentScreen('Profile') },
    { label: 'Stations', action: () => setCurrentScreen('Stations') },
    { label: 'Wallet', action: () => setCurrentScreen('Wallet') },
    { label: 'Driver Dash', action: () => {
      console.log('Navigating to DriverMapScreen');
      navigation.dispatch(StackActions.replace('DriverMapScreen'));
    } },
    { label: 'Sign Out', action: () => auth.signOut().then(() => navigation.navigate('Login')) },
  ];

  const handlePhotoUpload = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (!result.canceled && result.assets[0].uri) {
      const user = auth.currentUser;
      if (user) {
        const response = await fetch(result.assets[0].uri);
        const blob = await response.blob();
        const storageRef = ref(storage, `profilePics/${user.uid}`);
        await uploadBytes(storageRef, blob);
        const photoURL = await getDownloadURL(storageRef);
        setUserData({ ...userData!, photo: photoURL });
        await setDoc(doc(db, 'users', user.uid), { ...userData!, photo: photoURL }, { merge: true });
        Alert.alert('Success', 'Profile photo updated!');
      }
    }
  };

  const handleSaveProfile = async () => {
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, 'users', user.uid), editedData, { merge: true });
      setUserData(editedData);
      setIsEditing(false);
      Alert.alert('Success', 'Profile Updated!');
    }
  };

  const handleSaveStation = async () => {
    if (!stationData.chargeRate || !stationData.address || !stationData.adapterTypes.length || stationData.latitude === 0 || stationData.longitude === 0) {
      Alert.alert('Error', 'Please fill in all fields and select at least one adapter type.');
      return;
    }
    const user = auth.currentUser;
    if (user) {
      try {
        console.log('Saving station for user:', user.uid);
        let photoURL = stationData.photo;
        if (stationData.photo && stationData.photo.startsWith('file://')) {
          const response = await fetch(stationData.photo);
          const blob = await response.blob();
          const storageRef = ref(storage, `stationPics/${user.uid}/${Date.now()}`);
          await uploadBytes(storageRef, blob);
          photoURL = await getDownloadURL(storageRef);
          console.log('Photo uploaded:', photoURL);
        }
        const newStation: StationData = { id: `${user.uid}_${Date.now()}`, chargeRate: stationData.chargeRate, address: stationData.address, adapterTypes: stationData.adapterTypes, photo: photoURL, available: true, latitude: stationData.latitude, longitude: stationData.longitude, ownerId: user.uid };
        console.log('Station data to save:', newStation);
        await setDoc(doc(db, 'stations', newStation.id), newStation);
        console.log('Station saved:', newStation.id);
        setStations([...stations, newStation]);
        setStationData({ id: '', chargeRate: '', address: '', adapterTypes: [], photo: null, available: true, latitude: 0, longitude: 0, ownerId: '' });
        setIsAddStationModalVisible(false);
        Alert.alert('Success', 'Station Added!');
      } catch (error) {
        console.error('Station save error:', error);
        Alert.alert('Error', 'Failed to add station: ' + (error as Error).message);
      }
    } else {
      Alert.alert('Error', 'User not authenticated.');
    }
  };

  const toggleStationAvailability = async (stationId: string, currentAvailability: boolean) => {
    const stationRef = doc(db, 'stations', stationId);
    await setDoc(stationRef, { available: !currentAvailability }, { merge: true });
    setStations(stations.map(s => s.id === stationId ? { ...s, available: !currentAvailability } : s));
  };

  const renderScreen = () => {
    console.log('OwnerDash - Rendering screen:', currentScreen);
    if (!userData) return null;
    switch (currentScreen) {
      case 'Profile':
        return <ProfileSection userData={userData} isEditing={isEditing} setIsEditing={setIsEditing} editedData={editedData} setEditedData={setEditedData} onSave={handleSaveProfile} />;
        case 'Stations':
          return (
            <View style={styles.content}>
              <Text style={styles.sectionTitle}>Stations</Text>
              {stations.length === 0 ? (
                <Text style={styles.message}>No stations yet. Add one below!</Text>
              ) : (
                <ScrollView>
                  {stations.map(station => (
                    <View key={station.id} style={styles.stationItem}>
                      <Text>{station.address}</Text>
                      <Text>${station.chargeRate} per minute - {station.adapterTypes.join(', ')}</Text>
                      <TouchableOpacity onPress={() => toggleStationAvailability(station.id, station.available)}>
                        <Text>{station.available ? 'Make Unavailable' : 'Make Available'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity style={styles.actionButton} onPress={() => setIsAddStationModalVisible(true)}>
                <Text style={styles.buttonText}>Add Station</Text>
              </TouchableOpacity>
            </View>
          );
      case 'Wallet':
        return (
          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Wallet</Text>
            <Text style={styles.cashAmount}>$0.00</Text>
            <TouchableOpacity style={styles.actionButton} onPress={() => Alert.alert('Info', 'Cash Out coming soon!')}>
              <Text style={styles.buttonText}>💵 Cash Out</Text>
            </TouchableOpacity>
          </View>
        );
      default:
        return (
          <View style={styles.content}>
            <Text style={styles.welcome}>Welcome, {userData.firstName}! Manage your stations here.</Text>
          </View>
        );
    }
  };

  if (loading) {
    return <View style={styles.loadingContainer}><Text>Loading...</Text></View>;
  }

  console.log('OwnerDashScreen rendering');
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.photoContainer} onPress={handlePhotoUpload}>
        {userData?.photo ? (
          <Image source={{ uri: userData.photo }} style={styles.profilePhoto} />
        ) : (
          <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderText}>Add Photo</Text></View>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.menuButton} onPress={() => setIsMenuVisible(true)}>
        <Text style={styles.menuText}>☰</Text>
      </TouchableOpacity>
      {renderScreen()}
      <MenuModal isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)} options={menuOptions} />
      <AddStationModal isVisible={isAddStationModalVisible} onClose={() => setIsAddStationModalVisible(false)} stationData={stationData} setStationData={setStationData} onSave={handleSaveStation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e6f0ff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  photoContainer: { position: 'absolute', top: 40, left: 20, zIndex: 1 },
  profilePhoto: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#1E90FF' },
  photoPlaceholder: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ccc' },
  photoPlaceholderText: { color: '#666', fontSize: 12 },
  menuButton: { position: 'absolute', top: 40, right: 20, padding: 10, zIndex: 10, backgroundColor: '#fff', borderRadius: 5 },
  menuText: { fontSize: 24, color: '#1E90FF' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingTop: 100 },
  sectionTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#1E90FF' },
  welcome: { fontSize: 18, color: '#333', textAlign: 'center' },
  message: { fontSize: 16, color: '#666', marginBottom: 20 },
  cashAmount: { fontSize: 32, fontWeight: 'bold', color: '#333', marginBottom: 20 },
  menuModal: { 
    margin: 0, 
    justifyContent: 'flex-end', 
    alignItems: 'flex-end',
    paddingTop: 60,
  },
  menu: {
    width: '60%',
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 15,
    borderBottomLeftRadius: 15,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  menuItem: { paddingVertical: 15 },
  menuItemText: { fontSize: 18, color: '#333' },
  profileSection: { width: '100%', padding: 20, alignItems: 'center', paddingTop: 80 },
  label: { fontSize: 16, color: '#666', alignSelf: 'flex-start', marginTop: 10 },
  bubble: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10, width: '100%', backgroundColor: '#fff', marginVertical: 5 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10, width: '100%', backgroundColor: '#fff', marginVertical: 5 },
  actionButton: { backgroundColor: '#1E90FF', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 25, marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  modalContent: { width: '90%', backgroundColor: '#fff', padding: 20, borderRadius: 15, alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  centeredModal: { justifyContent: 'center', alignItems: 'center' },
  stationPhoto: { width: 120, height: 120, borderRadius: 10, marginVertical: 10 },
  stationItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  suggestionList: { maxHeight: 150, width: '100%', backgroundColor: '#fff', borderRadius: 5, marginBottom: 5 },
  suggestionItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  adapterContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginVertical: 10 },
  adapterButton: { padding: 10, margin: 5, borderWidth: 1, borderColor: '#1E90FF', borderRadius: 5 },
  adapterButtonSelected: { backgroundColor: '#1E90FF' },
  adapterText: { color: '#1E90FF', fontSize: 14 },
});