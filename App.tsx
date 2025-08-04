import React, { useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import DeviceModal from "./DeviceConnectionModal";
import useBLE from "./useBLE";

const App = () => {
  const {
    allDevices,
    connectedDevice,
    connectToDevice,
    disconnectDevice,
    color,
    isConnecting,
    requestPermissions,
    scanForPeripherals,
  } = useBLE();
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);

  const scanForDevices = async () => {
    const isPermissionsEnabled = await requestPermissions();
    if (isPermissionsEnabled) {
      scanForPeripherals();
    }
  };

  const hideModal = () => {
    setIsModalVisible(false);
  };

  const openModal = async () => {
    scanForDevices();
    setIsModalVisible(true);
  };

  const handleDisconnect = () => {
    disconnectDevice();
  };

  const renderConnectionStatus = () => {
    if (isConnecting) {
      return (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="large" color="#FF6060" />
          <Text style={styles.heartRateTitleText}>Connecting...</Text>
        </View>
      );
    }

    if (connectedDevice) {
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.heartRateTitleText}>Connected to QBike Lock</Text>
          <Text style={styles.deviceNameText}>
            {connectedDevice.name || connectedDevice.id}
          </Text>
          <TouchableOpacity 
            onPress={handleDisconnect} 
            style={[styles.ctaButton, styles.disconnectButton]}
          >
            <Text style={styles.ctaButtonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.statusContainer}>
        <Text style={styles.heartRateTitleText}>
          Please connect to your QBike Lock
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: color }]}>
      <View style={styles.heartRateTitleWrapper}>
        {renderConnectionStatus()}
      </View>

      {!connectedDevice && !isConnecting && (
        <TouchableOpacity onPress={openModal} style={styles.ctaButton}>
          <Text style={styles.ctaButtonText}>Connect Device</Text>
        </TouchableOpacity>
      )}

      <DeviceModal
        closeModal={hideModal}
        visible={isModalVisible}
        connectToPeripheral={connectToDevice}
        devices={allDevices}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f2",
  },
  heartRateTitleWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  statusContainer: {
    alignItems: "center",
  },
  heartRateTitleText: {
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
    marginHorizontal: 20,
    color: "black",
  },
  deviceNameText: {
    fontSize: 18,
    marginTop: 10,
    color: "#666",
    textAlign: "center",
  },
  heartRateText: {
    fontSize: 25,
    marginTop: 15,
  },
  ctaButton: {
    backgroundColor: "#FF6060",
    justifyContent: "center",
    alignItems: "center",
    height: 50,
    marginHorizontal: 20,
    marginBottom: 5,
    borderRadius: 8,
  },
  disconnectButton: {
    backgroundColor: "#666",
    marginTop: 20,
    marginHorizontal: 0,
    paddingHorizontal: 30,
  },
  ctaButtonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "white",
  },
});

export default App;