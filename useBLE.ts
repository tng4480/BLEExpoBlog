import { PermissionsAndroid, Platform } from "react-native";
import { useMemo, useState, useRef, useEffect } from "react";
import * as ExpoDevice from "expo-device";
import base64 from "react-native-base64";
import { BleError, BleManager, Characteristic, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";

const DATA_SERVICE_UUID = "00001548-1212-efde-1523-785feabcd123";
const READ_CHARACTERISTIC_UUID = "00001528-1212-efde-1523-785feabcd123";
const WRITE_CHARACTERISTIC_UUID = "00001526-1212-efde-1523-785feabcd123";

const bleManager = new BleManager();

function useBLE() {
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [color, setColor] = useState("white");
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Keep track of polling interval to clean up properly
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset all state when device disconnects
  const resetState = () => {
    setConnectedDevice(null);
    setColor("white");
    setIsConnecting(false);
    
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
    if (Platform.OS === "android") {
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
    } else {
      return true;
    }
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

  const isDuplicateDevice = (devices: Device[], nextDevice: Device) =>
    devices.findIndex((device) => nextDevice.id === device.id) > -1;

  const scanForPeripherals = () => {
    // Clear previous devices when starting a new scan
    setAllDevices([]);
    
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.log("Scan error:", error);
        return;
      }

      if (
        device &&
        (device.localName === "QBike Lock" || device.name === "QBike Lock")
      ) {
        setAllDevices((prevState: Device[]) => {
          if (!isDuplicateDevice(prevState, device)) {
            console.log("Found QBike Lock:", device.name || device.id);
            return [...prevState, device];
          }
          return prevState;
        });
      }
    });
  };

  const onDataUpdate = (
    error: BleError | null,
    characteristic: Characteristic | null
  ) => {
    if (error) {
      console.log("Data update error:", error);
      return;
    } 
    
    if (!characteristic?.value) {
      console.log("No data was received");
      return;
    }

    const colorCode = base64.decode(characteristic.value);
    console.log("Received color code:", colorCode);

    let newColor = "white";
    switch (colorCode) {
      case "B":
        newColor = "blue";
        break;
      case "R":
        newColor = "red";
        break;
      case "G":
        newColor = "green";
        break;
      default:
        newColor = "white";
    }

    setColor(newColor);
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
    await readAndWriteData();

    // Set up polling interval
    pollingIntervalRef.current = setInterval(readAndWriteData, 5000);
    console.log("Started data polling every 5 seconds");
  };

  return {
    connectToDevice,
    disconnectDevice, // New function to manually disconnect
    allDevices,
    connectedDevice,
    color,
    isConnecting, // New state to show connection status
    requestPermissions,
    scanForPeripherals,
    startStreamingData,
  };
}

export default useBLE;