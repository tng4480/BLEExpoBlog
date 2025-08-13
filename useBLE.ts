import { PermissionsAndroid, Platform } from "react-native";
import { useState, useRef, useEffect } from "react";
import * as ExpoDevice from "expo-device";
import base64 from "react-native-base64";
import { BleError, BleManager, Characteristic, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import { ScanMode } from "react-native-ble-plx";


const DATA_SERVICE_UUID = "00001548-1212-efde-1523-785feabcd123";
const READ_CHARACTERISTIC_UUID = "00001528-1212-efde-1523-785feabcd123";
const WRITE_CHARACTERISTIC_UUID = "00001526-1212-efde-1523-785feabcd123";

const bleManager = new BleManager();

function useBLE() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Keep track of polling interval to clean up properly
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset all state when device disconnects
  const resetState = () => {
    setConnectedDevice(null);
    setIsConnecting(false);
    setIsScanning(false);
    
    // Clear any existing polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      bleManager.stopDeviceScan();
    };
  }, []);

  const requestAndroid31Permissions = async () => {
    const bluetoothScanPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      {
        title: "Bluetooth Permission",
        message: "This app needs Bluetooth access to connect to your QBike Lock",
        buttonPositive: "OK",
      }
    );
    const bluetoothConnectPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: "Bluetooth Permission",
        message: "This app needs Bluetooth access to connect to your QBike Lock",
        buttonPositive: "OK",
      }
    );
    const fineLocationPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: "Location Permission",
        message: "Bluetooth Low Energy requires Location access",
        buttonPositive: "OK",
      }
    );

    return (
      bluetoothScanPermission === "granted" &&
      bluetoothConnectPermission === "granted" &&
      fineLocationPermission === "granted"
    );
  };

  const requestPermissions = async () => {
    if (Platform.OS === "ios") {
      // iOS handles Bluetooth permissions automatically when BLE is accessed
      // The system will show permission prompts as needed
      return true;
    } else if (Platform.OS === "android") {
      if ((ExpoDevice.platformApiLevel ?? -1) < 31) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: "Location Permission",
            message: "Bluetooth Low Energy requires Location access",
            buttonPositive: "OK",
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        return await requestAndroid31Permissions();
      }
    }
    return false;
  };

  const connectToDevice = async (device: Device) => {
    if (isConnecting) return; // Prevent multiple connection attempts
    
    try {
      setIsConnecting(true);
      console.log(`Attempting to connect to device: ${device.name || device.id}`);
      
      const deviceConnection = await bleManager.connectToDevice(device.id);
      console.log("Device connected successfully");
      
      setConnectedDevice(deviceConnection);
      await deviceConnection.discoverAllServicesAndCharacteristics();
      console.log("Services and characteristics discovered");
      
      bleManager.stopDeviceScan();
      setIsScanning(false);

      // Set up disconnect listener BEFORE starting data streaming
      deviceConnection.onDisconnected((error, disconnectedDevice) => {
        console.log("Device disconnected:", disconnectedDevice?.name || disconnectedDevice?.id);
        if (error) {
          console.log("Disconnect error:", error);
        }
        resetState(); // Reset all state when device disconnects
      });

      await startStreamingData(deviceConnection);
      setIsConnecting(false);
      
    } catch (error) {
      console.log("FAILED TO CONNECT:", error instanceof Error ? error.message : String(error));
      setIsConnecting(false);
      resetState();
    }
  };

  // Manually disconnect device
  const disconnectDevice = async () => {
    if (connectedDevice) {
      try {
        await bleManager.cancelDeviceConnection(connectedDevice.id);
        console.log("Device disconnected manually");
        // resetState will be called by the onDisconnected callback
      } catch (error) {
        console.log("Error disconnecting device:", error instanceof Error ? error.message : String(error));
        resetState(); // Reset state even if disconnect fails
      }
    }
  };

  // Auto-scan and connect to first QBike Lock found
  const scanAndConnect = async () => {
    if (isScanning || isConnecting || connectedDevice) return;
    
    const isPermissionsEnabled = await requestPermissions();
    if (!isPermissionsEnabled) {
      console.log("Permissions not granted");
      return;
    }

    setIsScanning(true);
    console.log("Starting scan for QBike Lock...");
    
    bleManager.startDeviceScan(null, Platform.OS === "android" ? { scanMode: ScanMode.LowLatency } : null, (error, device) => {
      if (error) {
        console.log("Scan error:", error);
        setIsScanning(false);
        return;
      }

      if (
        device &&
        (device.localName === "QBike Lock" || device.name === "QBike Lock")
      ) {
        console.log("Found QBike Lock! Auto-connecting...", device.name || device.id);
        
        // Stop scanning and connect immediately
        bleManager.stopDeviceScan();
        setIsScanning(false);
        connectToDevice(device);
      }
    });
  };

  const startStreamingData = async (device: Device) => {
    if (!device) {
      console.log("No device connected");
      return;
    }

    // Clear any existing interval first
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const readAndWriteData = async () => {
      try {
        // Read characteristic
        const characteristic = await device.readCharacteristicForService(
          DATA_SERVICE_UUID,
          READ_CHARACTERISTIC_UUID
        );
        
        if (!characteristic.value) {
          console.log("Characteristic returned no value");
          return;
        }

        // Decode Base64 to raw bytes, then to hex
        const raw = Buffer.from(characteristic.value, "base64");
        const hex = raw.toString("hex");
        console.log("Raw hex data:", hex);

        // Convert hex back to bytes and then to Base64 for writing
        const bytes = Buffer.from(hex, "hex");
        const base64Value = bytes.toString("base64");

        // Write back to device
        await device.writeCharacteristicWithResponseForService(
          DATA_SERVICE_UUID,
          WRITE_CHARACTERISTIC_UUID,
          base64Value
        );

        console.log(`Successfully wrote hex ${hex} as Base64 ${base64Value}`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log("Read/Write error:", errorMessage);
        // If we get a connection error, the device might have disconnected
        if (errorMessage.includes("disconnected") || errorMessage.includes("not connected")) {
          resetState();
        }
      }
    };

    // Initial read/write
    console.log("Performing initial read/write...");
    await readAndWriteData();

    // Set up polling interval
    pollingIntervalRef.current = setInterval(readAndWriteData, 5000);
    console.log("Started data polling every 5 seconds");
  };

  return {
    connectedDevice,
    isScanning,
    isConnecting,
    scanAndConnect, // New function to auto-scan and connect
    disconnectDevice,
    requestPermissions,
  };
}

export default useBLE;