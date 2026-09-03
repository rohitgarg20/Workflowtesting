import { getToken } from "@react-native-firebase/messaging";

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    getNumber: jest.fn(),
    getBoolean: jest.fn(),
    contains: jest.fn(),
    remove: jest.fn(),
    clearAll: jest.fn(),
  })),
}));

const mockMessaging = {
  getToken: jest.fn().mockResolvedValue('mock-token'),
};

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => mockMessaging),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(),
  setBackgroundMessageHandler: jest.fn()
}))
jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn()
}))

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: jest.fn()
}))

jest.mock('@react-navigation/native', () => ({

}))