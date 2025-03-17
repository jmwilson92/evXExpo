import React, { useState, useEffect, useRef, useMemo, useCallback, ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, FlatList, Image, Alert, ScrollView, TextInput, Linking, TouchableWithoutFeedback, GestureResponderEvent } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import Modal from 'react-native-modal';
import { StackNavigationProp } from '@react-navigation/stack';
import { StackActions } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db, stripePublishableKey } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { StripeProvider, useStripe, CardField } from '@stripe/stripe-react-native';
import { ListRenderItem } from 'react-native';
import debounce from 'lodash/debounce';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebase from 'firebase/compat';
import { collection, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';

type DriverMapScreenNavigationProp = StackNavigationProp<RootStackParamList, 'DriverMapScreen'>;

interface DriverMapScreenProps {
  navigation: DriverMapScreenNavigationProp;
}

interface UserData {
  walletBalance: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photo: string | null;
  role: 'Driver' | 'Owner' | 'Both';
  stripeToken?: string;
}

interface StationData {
  networkType: string;
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
  status?: string;
  paymentIntentId?: string;
}

interface MenuOption {
  label: string;
  action: () => void;
}
interface AppState {
  userData: UserData | null;
  stations: StationData[];
  userLocation: { latitude: number; longitude: number } | null;
  loading: boolean;
  selectedStation: StationData | null;
  isStationModalVisible: boolean;
  isMenuVisible: boolean;
  currentScreen: string;
  chargeSession: ChargeSession | null;
  isEditing: boolean;
  editedData: UserData;
  filterType: string | null;
  rangeFilter: number;
  chargerLevelFilter: string | null;
  networkFilter: string | null;
  pastCharges: ChargeSession[];
  isUpdating: boolean;
  listenerEnabled: boolean;
  isUpdatingState: boolean;
  hasShownProximityDialog: boolean;
  hasShownEndChargeDialog: boolean;
}
interface ProfileSectionProps {
  userData: UserData | null;
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  editedData: UserData;
  setEditedData: (data: UserData) => void;
  onSave: () => void;
  onUploadPhoto: () => void;
  onSaveBilling: () => void;
  setIsUpdatingState: (value: boolean) => void;
  setAppStateSafe: (updater: (prev: AppState) => AppState) => void; // Use AppState instead of typeof appState
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logToFile(`ErrorBoundary caught error: ${error.message}, Stack: ${errorInfo.componentStack}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text>Something went wrong: {this.state.error?.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const logToFile = (message: string, pastCharges?: ChargeSession[]) => {
  console.log(message);
};

const MenuModal = React.memo(
  ({ isVisible, onClose, options }: { isVisible: boolean; onClose: () => void; options: MenuOption[] }) => {
    logToFile(`MenuModal - Rendering - isVisible: ${isVisible}, options length: ${options.length}`);

    if (!isVisible) {
      logToFile('MenuModal - Not visible, returning null');
      return null;
    }

    return (
      <Modal
        isVisible={isVisible}
        onBackdropPress={() => {
          logToFile('MenuModal - Backdrop pressed, calling onClose');
          onClose();
        }}
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
                logToFile(`MenuModal - Option pressed: ${option.label}`);
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
  },
  (prevProps, nextProps) =>
    prevProps.isVisible === nextProps.isVisible &&
    prevProps.options === nextProps.options &&
    prevProps.onClose === nextProps.onClose
);

class CardFieldErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logToFile(`CardFieldErrorBoundary caught error: ${error.message}, Stack: ${errorInfo.componentStack}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text>Card Field Error: {this.state.error?.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const ProfileSection = React.memo(
  ({
    userData,
    isEditing,
    setIsEditing,
    editedData,
    setEditedData,
    onSave,
    onUploadPhoto,
    onSaveBilling,
    setIsUpdatingState, // Add this
    setAppStateSafe, // Add this
  }: ProfileSectionProps) => {
    interface CardDetailsWithError {
      complete: boolean;
      brand?: string;
      last4?: string;
      expiryMonth?: number;
      expiryYear?: number;
      postalCode?: string;
      error?: { message: string; code: string };
    }

    const handleRemoveCard = async () => {
      if (!auth.currentUser) {
        logToFile('handleRemoveCard - No user authenticated');
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      try {
        setIsUpdatingState(true);
        const userRef = db.collection('users').doc(auth.currentUser.uid);
        await updateDoc(userRef, { stripeToken: null });
        setAppStateSafe(prev => {
          if (!prev.userData) {
            logToFile('handleRemoveCard - userData is null, cannot update state');
            return prev;
          }
          return {
            ...prev,
            userData: { ...prev.userData, stripeToken: undefined },
            editedData: { ...prev.editedData, stripeToken: undefined },
          };
        });
        Alert.alert('Success', 'Card removed successfully!');
      } catch (error: unknown) {
        logToFile('handleRemoveCard - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
        Alert.alert('Error', `Failed to remove card: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsUpdatingState(false);
      }
    };

    logToFile(`ProfileSection - Rendering - isEditing: ${isEditing}, userData: ${JSON.stringify(userData)}`);

    if (!userData) {
      logToFile('ProfileSection - No userData, returning null');
      return null;
    }

    return (
      <ScrollView contentContainerStyle={styles.profileSection}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {userData.photo && <Image source={{ uri: userData.photo }} style={styles.profileImage} />}
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
        <Text style={styles.label}>Billing</Text>
        {!isEditing && (
          <Text style={styles.bubble}>
            {userData.stripeToken ? 'Card on file' : 'No card on file - Add in Edit mode'}
          </Text>
        )}
        <CardFieldErrorBoundary>
          <View style={isEditing ? styles.cardFieldContainer : [styles.cardFieldContainer, { display: 'none' }]}>
            <CardField
              postalCodeEnabled={true}
              placeholders={{ number: '4242 4242 4242 4242' }}
              cardStyle={{
                backgroundColor: '#FFFFFF',
                textColor: '#000000',
              }}
              style={styles.cardField}
              onCardChange={(cardDetails: CardDetailsWithError) => {
                logToFile(`CardField - Card changed: ${JSON.stringify(cardDetails)}`);
                if (cardDetails.error) {
                  logToFile(`CardField - Validation error: ${JSON.stringify(cardDetails.error)}`);
                }
              }}
            />
          </View>
        </CardFieldErrorBoundary>
        {isEditing && userData.stripeToken && (
          <TouchableOpacity style={styles.removeButton} onPress={handleRemoveCard}>
            <Text style={styles.buttonText}>Remove Card</Text>
          </TouchableOpacity>
        )}
        {isEditing && (
          <TouchableOpacity style={styles.actionButton} onPress={onSaveBilling}>
            <Text style={styles.buttonText}>Save Billing</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionButton} onPress={() => (isEditing ? onSave() : setIsEditing(true))}>
          <Text style={styles.buttonText}>{isEditing ? 'Save' : 'Edit'}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isEditing === nextProps.isEditing &&
    prevProps.userData === nextProps.userData &&
    prevProps.editedData === nextProps.editedData
);

export default function DriverMapScreen({ navigation }: DriverMapScreenProps) {
  const { createPaymentMethod } = useStripe();
  const mapRef = useRef<MapView>(null);
  const unsubscribeRefs = useRef<{ stations?: () => void; charges?: () => void }>({});
  const isMounted = useRef(true);
  const [mapKey, setMapKey] = useState(0);

  const [appState, setAppState] = useState<AppState>({
    userData: null,
    stations: [],
    userLocation: null,
    loading: true,
    selectedStation: null,
    isStationModalVisible: false,
    isMenuVisible: false,
    currentScreen: 'Map',
    chargeSession: null,
    isEditing: false,
    editedData: {} as UserData,
    filterType: null,
    rangeFilter: 7,
    chargerLevelFilter: null,
    networkFilter: null,
    pastCharges: [],
    isUpdating: false,
    listenerEnabled: true,
    isUpdatingState: false,
    hasShownProximityDialog: false,
    hasShownEndChargeDialog: false,
  });

  const {
    userData,
    stations,
    userLocation,
    loading,
    selectedStation,
    isStationModalVisible,
    isMenuVisible,
    currentScreen,
    chargeSession,
    isEditing,
    editedData,
    filterType,
    rangeFilter,
    chargerLevelFilter,
    networkFilter,
    pastCharges,
    isUpdating,
    listenerEnabled,
    isUpdatingState,
    hasShownProximityDialog,
    hasShownEndChargeDialog,
  } = appState;

  useEffect(() => {
    logToFile(`DriverMapScreen - Initial isMenuVisible: ${isMenuVisible}`);
  }, []);

  const setAppStateSafe = (updater: (prev: typeof appState) => typeof appState) => {
    if (!isUpdatingState && isMounted.current) {
      setAppState(prev => {
        const newState = updater(prev);
        logToFile(`setAppStateSafe - New state: ${JSON.stringify(newState)}`);
        return newState;
      });
    }
  };
  
  const setUserData = (value: UserData | null) => {
    logToFile(`setUserData - Updating userData: ${JSON.stringify(value)}`);
    setAppStateSafe(prev => ({ ...prev, userData: value }));
  };
  
  const setStations = useCallback(
    debounce((value: StationData[]) => {
      logToFile(`setStations - Updating stations, count: ${value.length}`);
      setAppStateSafe(prev => ({ ...prev, stations: value }));
    }, 500),
    []
  );
  
  const setUserLocation = (value: { latitude: number; longitude: number } | null) => {
    logToFile(`setUserLocation - Updating userLocation: ${JSON.stringify(value)}`);
    setAppStateSafe(prev => ({ ...prev, userLocation: value }));
  };
  
  const setLoading = (value: boolean) => {
    logToFile(`setLoading - Updating loading: ${value}`);
    setAppStateSafe(prev => ({ ...prev, loading: value }));
  };
  
  const setSelectedStation = (value: StationData | null) => {
    logToFile(`setSelectedStation - Updating selectedStation: ${JSON.stringify(value)}`);
    setAppStateSafe(prev => ({ ...prev, selectedStation: value }));
  };
  
  const setIsStationModalVisible = (value: boolean) => {
    logToFile(`setIsStationModalVisible - Updating isStationModalVisible: ${value}`);
    setAppStateSafe(prev => ({ ...prev, isStationModalVisible: value }));
  };
  
  const setIsMenuVisible = (value: boolean) => {
    logToFile(`setIsMenuVisible called with value: ${value}`);
    setAppStateSafe(prev => ({ ...prev, isMenuVisible: value }));
  };
  
  const setCurrentScreen = (value: string) => {
    logToFile(`setCurrentScreen - Updating currentScreen: ${value}`);
    setAppStateSafe(prev => ({ ...prev, currentScreen: value }));
  };
  
  const setChargeSession = (value: ChargeSession | null) => {
    logToFile(`setChargeSession - Updating chargeSession: ${JSON.stringify(value)}`);
    setAppStateSafe(prev => ({ ...prev, chargeSession: value }));
  };
  
  const setIsEditing = (value: boolean) => {
    logToFile(`setIsEditing - Updating isEditing: ${value}`);
    setAppStateSafe(prev => ({ ...prev, isEditing: value }));
  };
  
  const setEditedData = (value: UserData) => {
    logToFile(`setEditedData - Updating editedData: ${JSON.stringify(value)}`);
    setAppStateSafe(prev => ({ ...prev, editedData: value }));
  };
  
  const setFilterType = (value: string | null) => {
    logToFile(`setFilterType - Updating filterType: ${value}`);
    setAppStateSafe(prev => ({ ...prev, filterType: value }));
  };
  
  const setRangeFilter = (value: number) => {
    logToFile(`setRangeFilter - Updating rangeFilter: ${value}`);
    setAppStateSafe(prev => ({ ...prev, rangeFilter: value }));
  };
  
  const setChargerLevelFilter = (value: string | null) => {
    logToFile(`setChargerLevelFilter - Updating chargerLevelFilter: ${value}`);
    setAppStateSafe(prev => ({ ...prev, chargerLevelFilter: value }));
  };
  
  const setNetworkFilter = (value: string | null) => {
    logToFile(`setNetworkFilter - Updating networkFilter: ${value}`);
    setAppStateSafe(prev => ({ ...prev, networkFilter: value }));
  };
  
  const setPastCharges = useCallback(
    (value: ChargeSession[]) => {
      logToFile(`setPastCharges - Updating pastCharges, count: ${value.length}`);
      setAppStateSafe(prev => ({ ...prev, pastCharges: value })); // Removed slice(0, 10)
    },
    []
  );
  
  const setIsUpdating = (value: boolean) => {
    logToFile(`setIsUpdating - Updating isUpdating: ${value}`);
    setAppStateSafe(prev => ({ ...prev, isUpdating: value }));
  };
  
  const setListenerEnabled = (value: boolean) => {
    logToFile(`setListenerEnabled - Updating listenerEnabled: ${value}`);
    setAppStateSafe(prev => ({ ...prev, listenerEnabled: value }));
  };
  
  const setIsUpdatingState = (value: boolean) => {
    logToFile(`setIsUpdatingState - Updating isUpdatingState: ${value}`);
    setAppStateSafe(prev => ({ ...prev, isUpdatingState: value }));
  };
  
  const setCurrentScreenCallback = useCallback((value: string) => setCurrentScreen(value), []);
  const handleSignOutCallback = useCallback(() => handleSignOut(), []);
  const handleOwnerDashNavigation = useCallback(() => {
    logToFile('menuOptions - Navigating to OwnerDashScreen');
    navigation.dispatch(StackActions.replace('OwnerDashScreen')); // Correct
    logToFile('menuOptions - Navigation dispatched');
  }, [navigation])
  
  const menuOptions = useMemo(() => {
    logToFile(`menuOptions - Generating menu options with userData: ${JSON.stringify(userData)}`);
    const baseOptions: MenuOption[] = [
      { label: 'Map', action: () => setCurrentScreenCallback('Map') },
      { label: 'Profile', action: () => setCurrentScreenCallback('Profile') },
      { label: 'Charges', action: () => setCurrentScreenCallback('Charges') },
      { label: 'Sign Out', action: handleSignOutCallback },
    ];
  
    if (userData?.role === 'Both') {
      baseOptions.splice(3, 0, {
        label: 'Owner Dash',
        action: handleOwnerDashNavigation,
      });
    }
  
    logToFile(`menuOptions - Generated options: ${JSON.stringify(baseOptions.map(opt => opt.label))}`);
    return baseOptions;
  }, [userData?.role, setCurrentScreenCallback, handleSignOutCallback, handleOwnerDashNavigation]);

  // Main setup effect for location and auth
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
  
    logToFile('DriverMap - useEffect triggered for auth and location'); // Debug log
  
    const setup = async () => {
      logToFile('DriverMap - setup function started'); // Debug log
  
      // Check for persisted login state
      const isLoggedIn = await AsyncStorage.getItem('isLoggedIn');
      logToFile(`DriverMap - Persisted login state: ${isLoggedIn}`); // Debug log
      if (isLoggedIn === 'true') {
        logToFile('DriverMap - Persisted login detected, waiting for auth');
      } else {
        logToFile('DriverMap - No persisted login, waiting for auth state');
      }
  
      // Ensure Firebase auth is initialized
      logToFile('DriverMap - Initializing Firebase auth state'); // Debug log
      const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        logToFile('DriverMap - Auth state check: ' + (user ? user.uid : 'No user')); // Debug log
        if (isMounted.current) {
          if (user) {
            await AsyncStorage.setItem('isLoggedIn', 'true'); // Persist login state
            const userRef = db.collection('users').doc(user.uid);
            try {
              const docSnap = await getDoc(userRef);
              if (docSnap.exists() && isMounted.current) {
                const data = docSnap.data() as UserData;
                logToFile('DriverMap - User role: ' + data.role);
                setUserData(data);
                setEditedData(data);
              } else {
                logToFile('DriverMap - No user doc, to Signup');
                if (isMounted.current) navigation.navigate('Signup');
              }
            } catch (error) {
              logToFile('DriverMap - Firestore fetch error: ' + (error instanceof Error ? error.message : 'Unknown error'));
            } finally {
              if (isMounted.current) setLoading(false);
            }
          } else {
            await AsyncStorage.removeItem('isLoggedIn'); // Clear persisted login state
            setUserData(null);
            setPastCharges([]);
            if (isMounted.current) {
              setLoading(false);
              navigation.navigate('Login');
            }
          }
        }
      });
  
      // Set up location services
      logToFile('DriverMap - Setting up location services'); // Debug log
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        logToFile('DriverMap - Location permission denied');
        if (isMounted.current) setLoading(false);
        return;
      }
  
      let location = await Location.getCurrentPositionAsync({});
      logToFile('DriverMap - Got initial location: ' + JSON.stringify(location.coords));
      if (isMounted.current) setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
  
      locationSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
        (newLocation) => {
          logToFile('DriverMap - Location updated: ' + JSON.stringify(newLocation.coords));
          if (isMounted.current) setUserLocation({
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
          });
        }
      );
  
      return () => {
        logToFile('DriverMap - Cleanup');
        isMounted.current = false;
        unsubscribeAuth();
        if (locationSubscription) locationSubscription.remove();
        if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
        if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
      };
    };
  
    setup().catch(error => {
      logToFile('DriverMap - Setup error: ' + (error instanceof Error ? error.message : 'Unknown error'));
      if (isMounted.current) setLoading(false);
    });
  }, [navigation]);
  
  // Listener setup effect for Firestore subscriptions
  useEffect(() => {
    const setupListeners = () => {
      logToFile('DriverMap - Setting up Firestore listeners');
      if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
      if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
  
      const chargesQuery = query(collection(db, 'charges'), where('driverId', '==', userData?.email || ''));
      unsubscribeRefs.current.charges = onSnapshot(chargesQuery, (snapshot: { docs: any[] }) => {
        if (!listenerEnabled || !isMounted.current || isUpdatingState) {
          logToFile('DriverMap - Charges listener skipped due to listenerEnabled: false, unmounted, or updating state');
          return;
        }
        const chargeList: ChargeSession[] = snapshot.docs.map((doc: { id: any; data: () => ChargeSession }) => ({
          ...doc.data(), // Spread first
          id: doc.id,    // Set id explicitly after to override any existing id field
        } as ChargeSession));
        setPastCharges(chargeList);
      }, (error: { message: string }) => logToFile('DriverMap - Charges snapshot error: ' + error.message));
  
      unsubscribeRefs.current.stations = onSnapshot(collection(db, 'stations'), (snapshot) => {
        if (!listenerEnabled || !isMounted.current || isUpdatingState) {
          logToFile('DriverMap - Stations listener skipped due to listenerEnabled: false, unmounted, or updating state');
          return;
        }
        const stationList: StationData[] = snapshot.docs.map(doc => ({
          ...doc.data(), // Spread first
          id: doc.id,    // Set id explicitly after
          status: doc.data().status || 'available',
        } as StationData));
        setStations(stationList);
      }, (error) => logToFile('DriverMap - Stations snapshot error: ' + error.message));
    };
  
    if (userData && listenerEnabled && isMounted.current && !isUpdatingState) {
      logToFile('DriverMap - User data changed, re-subscribing listeners');
      setupListeners();
    }
  
    return () => {
      if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
      if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
    };
  }, [userData, listenerEnabled, isUpdatingState]);
  
  // Proximity warning dialog
  useEffect(() => {
    if (!userLocation || !selectedStation || hasShownProximityDialog || !chargeSession) {
      return;
    }
  
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    logToFile(`Proximity check - Distance to station ${selectedStation.id}: ${distance}`);
  
    if (distance <= 0.5) {
      Alert.alert(
        'Proximity Warning',
        'You must start the charge immediately after you plug in your vehicle. Failure to do so may result in monetary fines, or termination of service.',
        [
          { text: 'OK', onPress: () => setAppStateSafe(prev => ({ ...prev, hasShownProximityDialog: true })) },
        ]
      );
    }
  }, [userLocation, selectedStation, chargeSession, hasShownProximityDialog]);
  
  // End charge notification dialog
  useEffect(() => {
    if (!userLocation || !selectedStation || hasShownEndChargeDialog || !chargeSession) {
      return;
    }
  
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    logToFile(`End charge check - Distance to station ${selectedStation.id}: ${distance}`);
  
    if (distance > 0.5) {
      Alert.alert(
        'End Charge Notification',
        'You are more than 0.5 miles away from the charging station. Please end your charge to avoid issues.',
        [
          { text: 'OK', onPress: () => setAppStateSafe(prev => ({ ...prev, hasShownEndChargeDialog: true })) },
          { text: 'End Charge', onPress: () => endCharge() },
        ]
      );
    }
  }, [userLocation, selectedStation, chargeSession, hasShownEndChargeDialog]);

  // End charge notification dialog
  useEffect(() => {
    if (!userLocation || !selectedStation || hasShownEndChargeDialog || !chargeSession) {
      return;
    }

    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    logToFile(`End charge check - Distance to station ${selectedStation.id}: ${distance}`);

    if (distance > 0.5) {
      Alert.alert(
        'End Charge Notification',
        'You are more than 0.5 miles away from the charging station. Please end your charge to avoid issues.',
        [
          { text: 'OK', onPress: () => setAppStateSafe(prev => ({ ...prev, hasShownEndChargeDialog: true })) },
          { text: 'End Charge', onPress: () => endCharge() },
        ]
      );
    }
  }, [userLocation, selectedStation, chargeSession, hasShownEndChargeDialog]);

  // End charge notification dialog
  useEffect(() => {
    if (!userLocation || !selectedStation || hasShownEndChargeDialog || !chargeSession) {
      return;
    }

    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    logToFile(`End charge check - Distance to station ${selectedStation.id}: ${distance}`);

    if (distance > 0.5) {
      Alert.alert(
        'End Charge Notification',
        'You are more than 0.5 miles away from the charging station. Please end your charge to avoid issues.',
        [
          { text: 'OK', onPress: () => setAppStateSafe(prev => ({ ...prev, hasShownEndChargeDialog: true })) },
          { text: 'End Charge', onPress: () => endCharge() },
        ]
      );
    }
  }, [userLocation, selectedStation, chargeSession, hasShownEndChargeDialog]);

  const handleMarkerPress = (station: StationData) => {
    logToFile(`handleMarkerPress - Pressed marker: ${station.id}`);
    if (mapRef.current) {
      logToFile('handleMarkerPress - Animating to region');
      mapRef.current.animateToRegion({
        latitude: station.latitude,
        longitude: station.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  };

  const handleTilePress = (station: StationData) => {
    logToFile(`handleTilePress - Tile pressed: ${station.id}`);
    setSelectedStation(station);
    setIsStationModalVisible(true);
  };

  const handleMapDoublePress = () => {
    logToFile('handleMapDoublePress - Double press on map');
    if (mapRef.current && userLocation) {
      logToFile('handleMapDoublePress - Recentering map');
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      }, 1000);
    }
  };

  const startNavigation = async () => {
    logToFile('startNavigation - Starting navigation');
    if (!selectedStation || !userData || !navigation) {
      logToFile('startNavigation - Missing required data');
      return;
    }

    const enRouteCount = stations.filter(s => s.status === 'enRoute' && s.driverId === userData.email).length;
    const chargingCount = stations.filter(s => s.status === 'charging' && s.driverId === userData.email).length;
    logToFile(`startNavigation - enRouteCount: ${enRouteCount}, chargingCount: ${chargingCount}`);
    if (enRouteCount > 0) {
      logToFile('startNavigation - Already navigating to a station');
      Alert.alert('Busy', 'You’re already navigating to a station.');
      return;
    }
    if (chargingCount > 0) {
      logToFile('startNavigation - Already charging at a station');
      Alert.alert('Busy', 'You’re already charging at a station.');
      return;
    }

    Alert.alert(
      'Navigate to Station',
      `Would you like to navigate to ${selectedStation.address}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: async () => {
            try {
              setIsUpdatingState(true);
              logToFile('startNavigation - Updating station to enRoute');
              const stationRef = db.collection('stations').doc(selectedStation.id);
              logToFile('startNavigation - Station ref path: ' + stationRef.path);
              await stationRef.update({
                status: 'enRoute',
                driverId: userData.email,
                enRouteTime: Date.now(),
              });
              logToFile('startNavigation - Navigation set to enRoute');
              setIsStationModalVisible(false);
              handleMarkerPress(selectedStation);

              const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedStation.address)}&travelmode=driving`;
              logToFile(`startNavigation - Opening URL: ${url}`);
              const supported = await Linking.canOpenURL(url);
              if (supported) {
                await Linking.openURL(url);
                logToFile('startNavigation - URL opened successfully');
              } else {
                logToFile('startNavigation - Cannot open maps URL');
                Alert.alert('Error', 'Cannot open maps—try again.');
              }
            } catch (error: unknown) {
              logToFile('startNavigation - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
              Alert.alert('Error', `Failed to start navigation: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
              setIsUpdatingState(false);
            }
          },
        },
      ]
    );
  };

  const startCharge = async () => {
    logToFile('startCharge - Starting charge process');
    if (!selectedStation || !userData || !userLocation) {
      logToFile('startCharge - Missing data: ' + JSON.stringify({ selectedStation, userData, userLocation }));
      Alert.alert('Error', 'Missing required data');
      return;
    }
  
    const chargingCount = stations.filter(s => s.status === 'charging' && s.driverId === userData.email).length;
    logToFile(`startCharge - Charging count: ${chargingCount}`);
    if (chargingCount > 0) {
      logToFile('startCharge - Already charging elsewhere');
      Alert.alert('Busy', 'You’re already charging at another station.');
      return;
    }
  
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      selectedStation.latitude,
      selectedStation.longitude
    );
    logToFile(`startCharge - Distance check: ${distance}`);
    if (distance > 0.5) {
      logToFile(`startCharge - Too far: ${distance}`);
      Alert.alert('Too Far', 'You must be within 0.5 miles to start charging.');
      return;
    }
  
    if (!userData.stripeToken) {
      logToFile('startCharge - Debug: No stripeToken, showing alert');
      Alert.alert(
        'Billing Required',
        'Please set up your billing information in Menu > Profile > Billing before starting a charge.',
        [
          { text: 'OK', onPress: () => setCurrentScreen('Profile') },
        ]
      );
      return;
    }
  
    try {
      logToFile('startCharge - Unsubscribing Firestore listeners');
      if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
      if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
      setIsUpdatingState(true);
      logToFile('startCharge - Setting isUpdating to true');
      setIsUpdating(true);
  
      logToFile('startCharge - Proceeding with charge, station: ' + selectedStation.id);
      const stationRef = db.collection('stations').doc(selectedStation.id);
      logToFile('startCharge - Station ref path: ' + stationRef.path);
      await stationRef.update({
        status: 'charging',
        available: false,
      });
      logToFile('startCharge - Station updated to charging');
  
      const session: ChargeSession = {
        id: `${userData.email}_${Date.now()}`,
        stationId: selectedStation.id,
        driverId: userData.email,
        startTime: Date.now(),
        status: 'pending',
      };
      const chargeRef = db.collection('charges').doc(session.id);
      logToFile('startCharge - Charge ref path: ' + chargeRef.path);
      await chargeRef.set(session);
      logToFile('startCharge - Charge session set in Firestore: ' + JSON.stringify(session));
  
      logToFile('startCharge - Updating state with chargeSession and currentScreen');
      setAppStateSafe(prev => ({
        ...prev,
        chargeSession: session,
        currentScreen: 'Charges',
      }));
  
      logToFile('startCharge - State update dispatched, re-subscribing listeners after delay');
      setTimeout(() => {
        logToFile('startCharge - Re-subscribing Firestore listeners');
        const setupListeners = () => {
          const chargesQuery = query(
            collection(db, 'charges'),
            where('driverId', '==', userData?.email || '')
          );
          unsubscribeRefs.current.charges = onSnapshot(chargesQuery, (snapshot: { docs: any[] }) => {
            if (!listenerEnabled || !isMounted.current || isUpdatingState) {
              logToFile('DriverMap - Charges listener skipped due to listenerEnabled: false, unmounted, or updating state');
              return;
            }
            const chargeList: ChargeSession[] = snapshot.docs.map((doc: { id: any; data: () => ChargeSession }) => ({
              ...doc.data(), // Spread first
              id: doc.id,    // Set id explicitly after
            } as ChargeSession));
            setPastCharges(chargeList);
          }, (error: { message: string }) => logToFile('DriverMap - Charges snapshot error: ' + error.message));
  
          unsubscribeRefs.current.stations = onSnapshot(collection(db, 'stations'), (snapshot) => {
            if (!listenerEnabled || !isMounted.current || isUpdatingState) {
              logToFile('DriverMap - Stations listener skipped due to listenerEnabled: false, unmounted, or updating state');
              return;
            }
            const stationList: StationData[] = snapshot.docs.map(doc => ({
              ...doc.data(), // Spread first
              id: doc.id,    // Set id explicitly after
              status: doc.data().status || 'available',
            } as StationData));
            setStations(stationList);
          }, (error) => logToFile('DriverMap - Stations snapshot error: ' + error.message));
        };
        setupListeners();
        if (isMounted.current) setIsUpdating(false);
        setIsUpdatingState(false);
      }, 4000);
      logToFile('startCharge - State updated');
    } catch (error: unknown) {
      logToFile('startCharge - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
      Alert.alert('Error', `Failed to start charge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logToFile('startCharge - Resetting isUpdating and re-subscribing listeners on error');
      if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
      if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
      const setupListeners = () => {
        const chargesQuery = query(
          collection(db, 'charges'),
          where('driverId', '==', userData?.email || '')
        );
        unsubscribeRefs.current.charges = onSnapshot(chargesQuery, (snapshot: { docs: any[] }) => {
          if (!listenerEnabled || !isMounted.current || isUpdatingState) {
            logToFile('DriverMap - Charges listener skipped due to listenerEnabled: false, unmounted, or updating state');
            return;
          }
          const chargeList: ChargeSession[] = snapshot.docs.map((doc: { id: any; data: () => ChargeSession }) => ({
            ...doc.data(), // Spread first
            id: doc.id,    // Set id explicitly after
          } as ChargeSession));
          setPastCharges(chargeList);
        }, (error: { message: string }) => logToFile('DriverMap - Charges snapshot error: ' + error.message));
  
        unsubscribeRefs.current.stations = onSnapshot(collection(db, 'stations'), (snapshot) => {
          if (!listenerEnabled || !isMounted.current || isUpdatingState) {
            logToFile('DriverMap - Stations listener skipped due to listenerEnabled: false, unmounted, or updating state');
            return;
          }
          const stationList: StationData[] = snapshot.docs.map(doc => ({
            ...doc.data(), // Spread first
            id: doc.id,    // Set id explicitly after
            status: doc.data().status || 'available',
          } as StationData));
          setStations(stationList);
        }, (error) => logToFile('DriverMap - Stations snapshot error: ' + error.message));
      };
      setupListeners();
      if (isMounted.current) setIsUpdating(false);
      setIsUpdatingState(false);
    }
  };

  const handleSaveBilling = async () => {
    logToFile('handleSaveBilling - Starting billing save process');
    if (!auth.currentUser || !editedData || !createPaymentMethod) {
      logToFile('handleSaveBilling - Missing user, edited data, or createPaymentMethod');
      Alert.alert('Error', 'User data or Stripe unavailable');
      return;
    }

    try {
      setIsUpdatingState(true);
      logToFile('handleSaveBilling - Creating payment method');
      const { paymentMethod, error } = await createPaymentMethod({
        paymentMethodType: 'Card',
      });

      if (error) {
        logToFile('handleSaveBilling - Stripe error: ' + JSON.stringify(error));
        Alert.alert('Error', `Stripe error: ${error.message}`);
        setIsUpdatingState(false);
        return;
      }

      if (!paymentMethod) {
        logToFile('handleSaveBilling - No payment method returned');
        Alert.alert('Error', 'No payment method created');
        setIsUpdatingState(false);
        return;
      }

      logToFile('handleSaveBilling - Payment method created: ' + paymentMethod.id);
      const userRef = db.collection('users').doc(auth.currentUser.uid);
      logToFile('handleSaveBilling - User ref path: ' + userRef.path);
      await updateDoc(userRef, { stripeToken: paymentMethod.id });
      logToFile('handleSaveBilling - Stripe token updated in Firestore');

      setAppStateSafe(prev => ({
        ...prev,
        isEditing: false,
        userData: { ...prev.userData!, stripeToken: paymentMethod.id },
        editedData: { ...prev.editedData, stripeToken: paymentMethod.id },
      }));
      logToFile('handleSaveBilling - Billing saved and editing disabled');
      Alert.alert('Success', 'Billing information updated!');
    } catch (error: unknown) {
      logToFile('handleSaveBilling - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
      Alert.alert('Error', `Failed to save billing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUpdatingState(false);
    }
  };

  const endCharge = async () => {
    if (!chargeSession || !selectedStation) {
      logToFile('endCharge - Missing chargeSession or selectedStation');
      Alert.alert('Error', 'No active charge session');
      return;
    }
  
    if (selectedStation.networkType === 'Out-net') {
      logToFile('endCharge - Out-of-network charger, no payment flow to end');
      Alert.alert('Info', 'This is an out-of-network charger. Payment is handled externally.');
      setChargeSession(null);
      return;
    }
  
    try {
      setIsUpdatingState(true);
      const endTime = Date.now();
      const duration = (endTime - chargeSession.startTime) / (1000 * 60); // Duration in minutes
      const totalCost = duration * parseFloat(selectedStation.chargeRate);
      const ownerShare = totalCost * 0.95; // 95% to owner
      const platformShare = totalCost * 0.05; // 5% to platform
  
      logToFile(`endCharge - Charge details: duration=${duration} min, totalCost=$${totalCost.toFixed(2)}, ownerShare=$${ownerShare.toFixed(2)}, platformShare=$${platformShare.toFixed(2)}`);
  
      // Update charge session with total cost
      const chargeRef = db.collection('charges').doc(chargeSession.id);
      await chargeRef.update({ endTime, totalCost });
      logToFile(`endCharge - Charge session ${chargeSession.id} updated with totalCost: $${totalCost.toFixed(2)}`);
  
      // Update station status
      const stationRef = db.collection('stations').doc(selectedStation.id);
      await stationRef.update({ status: 'available', driverId: null });
      setStations((prev: any[]) => prev.map((s: { id: string; }) => s.id === selectedStation.id ? { ...s, status: 'available', driverId: null } : s));
      logToFile(`endCharge - Station ${selectedStation.id} status updated to available`);
  
      // Update owner's wallet balance
      const ownerRef = db.collection('users').doc(selectedStation.ownerId);
      const ownerSnap = await ownerRef.get();
      if (ownerSnap.exists) {
        const ownerData = ownerSnap.data() as UserData;
        const currentBalance = ownerData.walletBalance || 0;
        const newBalance = currentBalance + ownerShare;
        await ownerRef.update({ walletBalance: newBalance });
        logToFile(`endCharge - Updated owner ${selectedStation.ownerId} wallet: Old=$${currentBalance.toFixed(2)}, New=$${newBalance.toFixed(2)}`);
      } else {
        logToFile(`endCharge - Owner ${selectedStation.ownerId} not found, creating new entry with initial balance`);
        await ownerRef.set({
          walletBalance: ownerShare,
          role: 'Owner', // Add minimal required fields for the owner
          email: `owner_${selectedStation.ownerId}@example.com`, // Placeholder, adjust as needed
        }, { merge: true });
        logToFile(`endCharge - Created owner ${selectedStation.ownerId} wallet with $${ownerShare.toFixed(2)}`);
      }
  
      // Store platform's share in platform_earnings collection
      const platformEarningRef = db.collection('platform_earnings').doc(`${chargeSession.id}_platform`);
      await platformEarningRef.set({
        chargeId: chargeSession.id,
        amount: platformShare,
        timestamp: endTime,
      });
      logToFile(`endCharge - Platform share recorded: $${platformShare.toFixed(2)} for charge ${chargeSession.id}`);
  
      setChargeSession(null);
      logToFile('endCharge - Charge session ended: ' + chargeSession.id + ', Total cost: $' + totalCost.toFixed(2));
      Alert.alert('Charge Ended', `Total cost: $${totalCost.toFixed(2)}`);
    } catch (error) {
      logToFile('endCharge - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
      Alert.alert('Error', 'Failed to end charge: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsUpdatingState(false);
    }
  };

  const handleSignOut = async () => {
    logToFile('handleSignOut - Starting sign out');
    try {
      setIsUpdatingState(true);
      await auth.signOut();
      await AsyncStorage.removeItem('isLoggedIn'); // Clear persisted login state
      logToFile('handleSignOut - Signed out successfully');
      setUserData(null);
      setPastCharges([]);
      setLoading(false);
      if (unsubscribeRefs.current.stations) unsubscribeRefs.current.stations();
      if (unsubscribeRefs.current.charges) unsubscribeRefs.current.charges();
      navigation.navigate('Login');
    } catch (error) {
      logToFile('handleSignOut - Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsUpdatingState(false);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    logToFile(`calculateDistance - Calculating distance between (${lat1}, ${lon1}) and (${lat2}, ${lon2})`);
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    logToFile(`calculateDistance - Distance calculated: ${distance} miles`);
    return distance;
  };

  const getPinColor = (station: StationData) => {
    logToFile(`getPinColor - Station ${station.id} status: ${station.status}`);
    let color: string;
    switch (station.status) {
      case 'enRoute':
        color = 'red'; // Keep all pins red as requested
        break;
      case 'charging':
        color = 'red'; // Keep all pins red as requested
        break;
      case 'available':
        color = 'red'; // Keep all pins red as requested
        break;
      default:
        logToFile(`getPinColor - Unknown status for station ${station.id}: ${station.status}, defaulting to red`);
        color = 'red';
        break;
    }
    logToFile(`getPinColor - Returning color: ${color} for station ${station.id}`);
    return color;
  };

  const getStatusDotColor = (status: string) => {
    logToFile(`getStatusDotColor - Status: ${status}`);
    switch (status) {
      case 'enRoute':
        return '#FFFF00'; // Yellow dot
      case 'charging':
        return '#FF0000'; // Red dot
      case 'available':
        return '#00FF00'; // Green dot
      default:
        logToFile(`getStatusDotColor - Unknown status: ${status}, defaulting to gray`);
        return '#808080'; // Gray dot for unknown status
    }
  };

  const getChargerLevelFromRate = (rate: number): string => {
    logToFile(`getChargerLevelFromRate - Rate: ${rate}`);
    if (rate <= 0.1) return 'Level 1'; // Example threshold for Level 1
    if (rate <= 0.25) return 'Level 2'; // Example threshold for Level 2
    return 'Level 3'; // Anything above as Level 3
  };

  const filteredStations = useMemo(() => {
    logToFile(`filteredStations - Filtering stations with filterType: ${filterType}, chargerLevelFilter: ${chargerLevelFilter}, stations: ${stations.length}`);
    let filtered = [...stations];
    if (filterType && filterType !== 'All') {
      filtered = filtered.filter(station =>
        station.adapterTypes.includes(filterType)
      );
      logToFile(`filteredStations - After adapter filter: ${filtered.length}`);
    }
    if (chargerLevelFilter) {
      filtered = filtered.filter(station => {
        const level = getChargerLevelFromRate(parseFloat(station.chargeRate));
        return chargerLevelFilter === 'All' || level === chargerLevelFilter;
      });
      logToFile(`filteredStations - After charger level filter: ${filtered.length}`);
    }
    return filtered;
  }, [stations, filterType, chargerLevelFilter]);

  const nearbyStations = useMemo(() => {
    logToFile(`nearbyStations - Filtering nearby stations with userLocation: ${JSON.stringify(userLocation)}, filteredStations: ${filteredStations.length}, rangeFilter: ${rangeFilter}`);
    if (!userLocation) {
      logToFile('nearbyStations - No userLocation, returning filteredStations');
      return filteredStations;
    }
    const nearby = filteredStations.filter(station => {
      const distance = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        station.latitude,
        station.longitude
      );
      const isNearby = distance <= rangeFilter;
      logToFile(`Station ${station.id} - Distance: ${distance} mi, Is nearby: ${isNearby}`);
      return isNearby;
    });
    logToFile(`nearbyStations - Nearby stations count: ${nearby.length}`);
    return nearby;
  }, [filteredStations, userLocation, rangeFilter]);

  const sortedStations = useMemo(() => {
    logToFile(`sortedStations - Sorting stations with userLocation: ${JSON.stringify(userLocation)}, nearbyStations: ${nearbyStations.length}`);
    if (!userLocation) {
      logToFile('sortedStations - No userLocation, returning nearbyStations');
      return nearbyStations;
    }
    const sorted = [...nearbyStations].sort((a, b) => {
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
      return distA - distB;
    });
    logToFile(`sortedStations - Sorted stations count: ${sorted.length}, Statuses: ${sorted.map(s => `${s.id}: ${s.status}`).join(', ')}`);
    setMapKey(prev => prev + 1); // Increment mapKey to force MapView re-render
    return sorted;
  }, [nearbyStations, userLocation]);

  const totalSpent = useMemo(() => {
    logToFile(`totalSpent - Calculating total spent with pastCharges count: ${pastCharges.length}`);
    const total = pastCharges.reduce((sum, charge) => sum + (charge.totalCost || 0), 0).toFixed(2);
    logToFile(`totalSpent - Total spent calculated: ${total}`);
    return total;
  }, [pastCharges]);

  const renderStationTile = ({ item }: { item: StationData }) => {
    logToFile(`renderStationTile - Rendering tile for station: ${item.id}, status: ${item.status}`);
    const dotColor = getStatusDotColor(item.status);
    const distance = userLocation
      ? calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(1)
      : 'N/A';
    return (
      <TouchableOpacity
        style={styles.tile}
        onPress={() => handleTilePress(item)}
      >
        <View style={styles.tileBackground}>
          <View style={styles.tileContent}>
            {item.photo ? (
              <Image source={{ uri: item.photo }} style={styles.tileImage} />
            ) : (
              <View style={styles.noImage}>
                <Text style={styles.tileText}>No Photo</Text>
              </View>
            )}
            <Text style={styles.tileText}>${item.chargeRate} Per Minute💵</Text>
            <View style={styles.bottomRow}>
              <Text style={styles.tileText}>{distance} mi</Text>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderChargeItem: ListRenderItem<ChargeSession> = ({ item }) => {
    logToFile(`renderChargeItem - Rendering charge item: ${item.id}`); // Debug log
    const station = stations.find(s => s.id === item.stationId) || { address: 'Unknown Station', chargeRate: 'N/A' };
    const minutes = item.endTime && item.startTime ? ((item.endTime - item.startTime) / (1000 * 60)).toFixed(2) : 'N/A';
    return (
      <View style={styles.chargeCard}>
        <Text style={styles.chargeCardText}>{station.address}</Text>
        <Text style={styles.chargeCardText}>Rate: ${station.chargeRate}/min</Text>
        <Text style={styles.chargeCardText}>Duration: ${minutes} min</Text>
        <Text style={styles.chargeCardText}>Cost: ${item.totalCost ? item.totalCost.toFixed(2) : 'N/A'}</Text>
      </View>
    );
  };

  const renderScreen = useCallback(() => {
    logToFile(`renderScreen - Rendering screen: ${currentScreen}, chargeSession: ${JSON.stringify(chargeSession)}, selectedStation: ${JSON.stringify(selectedStation)}`);
    if (!userData) {
      logToFile('renderScreen - No userData, returning null');
      return null;
    }
    switch (currentScreen) {
      case 'Profile':
        logToFile('renderScreen - Rendering Profile section');
        function handleSaveProfile(): void {
          throw new Error('Function not implemented.');
        }

        function handleUploadPhoto(): void {
          throw new Error('Function not implemented.');
        }

        return (
          <ErrorBoundary>
            <ProfileSection
              userData={userData}
              isEditing={isEditing}
              setIsEditing={setIsEditing}
              editedData={editedData}
              setEditedData={setEditedData}
              onSave={handleSaveProfile}
              onUploadPhoto={handleUploadPhoto}
              onSaveBilling={handleSaveBilling}
              setIsUpdatingState={setIsUpdatingState}
              setAppStateSafe={setAppStateSafe}
            />
          </ErrorBoundary>
        );
      case 'Charges':
        logToFile('renderScreen - Rendering Charges section, pastCharges: ', pastCharges);
        return (
          <ErrorBoundary>
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
                      logToFile('renderScreen - Start Charge pressed in Charges section');
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
                    onPress={async () => {
                      logToFile('renderScreen - Cancel Navigation pressed in Charges section');
                      const enRouteStation = stations.find(s => s.status === 'enRoute' && s.driverId === userData.email);
                      if (enRouteStation) {
                        try {
                          setIsUpdatingState(true);
                          const stationRef = db.collection('stations').doc(enRouteStation.id);
                          await stationRef.update({
                            status: 'available',
                            driverId: null,
                            enRouteTime: null,
                          });
                          setStations((prev: any[]) => prev.map((s: { id: string; }) => s.id === enRouteStation.id ? { ...s, status: 'available', driverId: null, enRouteTime: null } : s));
                        } catch (error) {
                          logToFile('renderScreen - Error canceling navigation: ' + (error instanceof Error ? error.message : 'Unknown error'));
                          Alert.alert('Error', 'Failed to cancel navigation');
                        } finally {
                          setIsUpdatingState(false);
                        }
                      }
                    }}
                  >
                    <Text style={styles.buttonText}>Cancel Navigation</Text>
                  </TouchableOpacity>
                </View>
              )}
              {chargeSession && selectedStation && (
                <View style={styles.chargeControl}>
                  <Text style={styles.chargeCardText}>Charging at: ${selectedStation.address}</Text>
                  <Text style={styles.chargeCardText}>Rate: ${selectedStation.chargeRate}/min</Text>
                  <Text style={styles.chargeCardText}>Started: {new Date(chargeSession.startTime).toLocaleTimeString()}</Text>
                  <TouchableOpacity style={styles.actionButton} onPress={endCharge}>
                    <Text style={styles.buttonText}>End Charge</Text>
                  </TouchableOpacity>
                </View>
              )}
              <FlatList
                data={Array.isArray(pastCharges) ? pastCharges : []}
                renderItem={renderChargeItem}
                keyExtractor={item => item.id}
                ListEmptyComponent={<Text style={styles.noChargesText}>No past charges yet, bruh!</Text>}
                contentContainerStyle={[styles.chargesList, { flexGrow: 1 }]} // Ensure FlatList grows to fit content
              />
            </View>
          </ErrorBoundary>
        );
      case 'Map':
      default:
        logToFile('renderScreen - Rendering Map section');
        return (
          <ErrorBoundary>
            <>
              <MapView
                key={`map-${mapKey}`}
                ref={mapRef}
                style={styles.map}
                initialRegion={
                  userLocation
                    ? {
                        latitude: userLocation.latitude,
                        longitude: userLocation.longitude,
                        latitudeDelta: 0.0922,
                        longitudeDelta: 0.0421,
                      }
                    : {
                        latitude: 37.78825,
                        longitude: -122.4324,
                        latitudeDelta: 0.0922,
                        longitudeDelta: 0.0421,
                      }
                }
                onDoublePress={handleMapDoublePress}
                pointerEvents="box-none"
              >
                {sortedStations.map(station => (
                  <Marker
                    key={`${station.id}-${station.status}`}
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
              {userData?.photo && <Image source={{ uri: userData.photo }} style={styles.profilePic} />}
              <View style={styles.filterContainer}>
                <TouchableOpacity
                  style={[styles.filterButton, !filterType && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Filter button pressed - All');
                    setFilterType(null);
                  }}
                >
                  <Text style={styles.filterText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, filterType === 'NACS' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Filter button pressed - NACS');
                    setFilterType('NACS');
                  }}
                >
                  <Text style={styles.filterText}>NACS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, filterType === 'CCS' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Filter button pressed - CCS');
                    setFilterType('CCS');
                  }}
                >
                  <Text style={styles.filterText}>CCS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, filterType === 'CHAdeMO' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Filter button pressed - CHAdeMO');
                    setFilterType('CHAdeMO');
                  }}
                >
                  <Text style={styles.filterText}>CHAdeMO</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chargerLevelFilterContainer}>
                <TouchableOpacity
                  style={[styles.filterButton, !chargerLevelFilter && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Charger level filter pressed - All');
                    setChargerLevelFilter(null);
                  }}
                >
                  <Text style={styles.filterText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, chargerLevelFilter === 'Level 1' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Charger level filter pressed - Level 1');
                    setChargerLevelFilter('Level 1');
                  }}
                >
                  <Text style={styles.filterText}>L1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, chargerLevelFilter === 'Level 2' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Charger level filter pressed - Level 2');
                    setChargerLevelFilter('Level 2');
                  }}
                >
                  <Text style={styles.filterText}>L2</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterButton, chargerLevelFilter === 'Level 3' && styles.filterButtonSelected]}
                  onPress={() => {
                    logToFile('Charger level filter pressed - Level 3');
                    setChargerLevelFilter('Level 3');
                  }}
                >
                  <Text style={styles.filterText}>L3</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.filterWrapper}>
                <View style={styles.rangeFilterContainer}>
                  <Text style={styles.filterLabel}>Miles</Text>
                  <View style={styles.filterButtonWrapper}>
                    <TouchableOpacity
                      style={[styles.filterButton, rangeFilter === 7 && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Range filter pressed - 7 miles');
                        setRangeFilter(7);
                      }}
                    >
                      <Text style={styles.filterText}>7</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, rangeFilter === 10 && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Range filter pressed - 10 miles');
                        setRangeFilter(10);
                      }}
                    >
                      <Text style={styles.filterText}>10</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, rangeFilter === 15 && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Range filter pressed - 15 miles');
                        setRangeFilter(15);
                      }}
                    >
                      <Text style={styles.filterText}>15</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, rangeFilter === 25 && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Range filter pressed - 25 miles');
                        setRangeFilter(25);
                      }}
                    >
                      <Text style={styles.filterText}>25</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, rangeFilter === 50 && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Range filter pressed - 50 miles');
                        setRangeFilter(50);
                      }}
                    >
                      <Text style={styles.filterText}>50</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.networkFilterContainer}>
                  <Text style={styles.filterLabel}>Network</Text>
                  <View style={styles.filterButtonWrapper}>
                    <TouchableOpacity
                      style={[styles.filterButton, !networkFilter && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Network filter pressed - All');
                        setNetworkFilter(null);
                      }}
                    >
                      <Text style={styles.filterText}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, networkFilter === 'In-net' && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Network filter pressed - In-net');
                        setNetworkFilter('In-net');
                      }}
                    >
                      <Text style={styles.filterText}>In</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, networkFilter === 'Out-net' && styles.filterButtonSelected]}
                      onPress={() => {
                        logToFile('Network filter pressed - Out-net');
                        setNetworkFilter('Out-net');
                      }}
                    >
                      <Text style={styles.filterText}>Out</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <View style={styles.tileWrapper}>
                <View style={styles.tileContainer}>
                  <View style={styles.tileBackground}>
                    <Text style={styles.tileTitle}>ChargeUps</Text>
                    <FlatList
                      data={sortedStations}
                      renderItem={renderStationTile}
                      keyExtractor={item => item.id}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.tileList}
                    />
                  </View>
                </View>
              </View>
            </>
          </ErrorBoundary>
        );
    }
  }, [currentScreen, chargeSession, selectedStation, userData, isEditing, editedData, totalSpent, pastCharges, sortedStations, filterType, rangeFilter, chargerLevelFilter, networkFilter]);
  
  logToFile('DriverMapScreen - Render cycle start, loading: ' + loading + ', userLocation: ' + !!userLocation);
if (loading || !userLocation) {
  logToFile('DriverMapScreen - Loading or no userLocation, rendering loading view');
  return (
    <View style={styles.loadingContainer}>
      <Text>Loading...</Text>
    </View>
  );
}
  
    return (
      <StripeProvider publishableKey={stripePublishableKey}>
        <TouchableWithoutFeedback
          onPress={() => logToFile('Root View Pressed - Touch event captured')}
          onPressIn={() => logToFile('Root View TouchStart - Touch event started')}
        >
          <View style={styles.container}>
            <TouchableOpacity
              style={[styles.menuButton, { zIndex: 1000 }]}
              onPress={() => {
                logToFile('Menu button pressed - Toggling isMenuVisible');
                setIsMenuVisible(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.menuText}>☰</Text>
            </TouchableOpacity>
            {renderScreen()}
            <Modal
              isVisible={isStationModalVisible}
              onBackdropPress={() => setIsStationModalVisible(false)}
              style={{ zIndex: 2000 }}
            >
              <View style={styles.modalContent}>
                {selectedStation && (
                  <>
                    <Text style={styles.modalTitle}>{selectedStation.address}</Text>
                    {selectedStation.photo && <Image source={{ uri: selectedStation.photo }} style={styles.modalImage} />}
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
            <Modal
              isVisible={isMenuVisible}
              onBackdropPress={() => {
                logToFile('MenuModal - Backdrop pressed, setting isMenuVisible to false');
                setIsMenuVisible(false);
              }}
              style={[styles.menuModal, { zIndex: 2000 }]}
              animationIn="slideInRight"
              animationOut="slideOutRight"
            >
              <View style={[styles.menu, { height: menuOptions.length * 60 + 40 }]}>
                {menuOptions.map((option, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.menuItem}
                    onPress={() => {
                      logToFile(`MenuModal - Option pressed: ${option.label}`);
                      option.action();
                      setIsMenuVisible(false);
                    }}
                  >
                    <Text style={styles.menuItemText}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Modal>
          </View>
        </TouchableWithoutFeedback>
      </StripeProvider>
    );
  }
  
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#e6f0ff' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    map: {
      width: Dimensions.get('window').width,
      height: Dimensions.get('window').height,
      zIndex: 1,
    },
    menuButton: {
      position: 'absolute',
      top: 60,
      right: 20,
      padding: 10,
      zIndex: 1000,
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
      zIndex: 1000,
    },
    filterContainer: {
      position: 'absolute',
      top: 120,
      left: 20,
      flexDirection: 'column',
      zIndex: 1000,
    },
    chargerLevelFilterContainer: {
      position: 'absolute',
      top: 120,
      right: 20,
      flexDirection: 'column',
      zIndex: 1000,
    },
    filterWrapper: {
      position: 'absolute',
      bottom: 205,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 1000,
      paddingHorizontal: 5,
    },
    rangeFilterContainer: {
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 8,
      paddingVertical: 2,
      paddingHorizontal: 2,
      marginLeft: 5,
      marginBottom: 5,
      zIndex: 1000,
    },
    networkFilterContainer: {
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 8,
      paddingVertical: 2,
      paddingHorizontal: 2,
      marginRight: 5,
      marginBottom: 5,
      zIndex: 1000,
    },
    filterButtonWrapper: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    filterLabel: {
      fontSize: 8,
      fontWeight: 'bold',
      color: '#333',
      marginBottom: 2,
    },
    filterButton: {
      backgroundColor: '#FFFFFF',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 15,
      marginHorizontal: 2,
      marginVertical: 4,
    },
    filterButtonSelected: {
      backgroundColor: '#1E90FF',
    },
    filterText: {
      fontSize: 10,
      color: '#333',
    },
    tileWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
    },
    tileContainer: {
      paddingTop: 10,
      height: 210,
      paddingBottom: 0,
    },
    tileList: {
      paddingHorizontal: 10,
    },
    tile: {
      marginRight: 10,
      padding: 5,
      width: 110,
      height: 150,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 5,
      elevation: 3,
    },
    tileBackground: {
      backgroundColor: '#FFFFFF',
      borderRadius: 10,
      padding: 5,
      width: '100%',
      height: '100%',
      alignItems: 'center',
    },
    tileContent: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    bottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      justifyContent: 'space-between',
    },
    tileTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#1E90FF',
      marginBottom: 5,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      position: 'absolute',
      bottom: 5,
      right: 5,
    },
    tileImage: {
      width: 90,
      height: 90,
      borderRadius: 5,
    },
    noImage: {
      width: 90,
      height: 90,
      borderRadius: 5,
      backgroundColor: '#ddd',
      justifyContent: 'center',
      alignItems: 'center',
    },
    tileText: {
      fontSize: 10,
      color: '#333',
      marginVertical: 2,
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
      zIndex: 2000,
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
      paddingVertical: 15,
    },
    menuItemText: {
      fontSize: 18,
      color: '#333',
    },
    content: {
      flex: 1,
      padding: 20,
      paddingTop: 100,
    },
    chargesList: {
      paddingBottom: 20,
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
      paddingTop: 80,
    },
    label: {
      fontSize: 16,
      color: '#666',
      alignSelf: 'flex-start',
      marginTop: 10,
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
    cardFieldContainer: {
      width: '100%',
      marginVertical: 10,
    },
    cardField: {
      width: '100%',
      height: 50,
      marginVertical: 10,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#fff',
    },
    removeButton: {
      backgroundColor: '#FF4444',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 25,
      marginTop: 10,
      marginBottom: 10,
    },
  });

function doc(db: firebase.firestore.Firestore, arg1: string, id: string) {
  throw new Error('Function not implemented.');
}


function Ascynchronous(arg0: () => number) {
  throw new Error('Function not implemented.');
}
