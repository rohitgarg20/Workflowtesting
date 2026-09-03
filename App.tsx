/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { createContext, useEffect, useState } from 'react';
import { Linking, NativeModules, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { CreateTaskScreen } from './src/screens/CreateTask';
import { AppContext } from './src/Context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import {
  getMessaging,
  onMessage,
  getInitialNotification,
  onNotificationOpenedApp,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import { getApp } from '@react-native-firebase/app';

const Stack = createNativeStackNavigator();

const messaging = getMessaging(getApp());

const linking:LinkingOptions<any> = {
  prefixes: ['exampleApp://', 'https://exampleapp.com'],
  config: {
    screens: {
      homeScreen: 'home',
      createTask: {
        path: 'task/:id',
        // parse: {
        //   meta: (queryParams: string) => {
        //     console.log("queryParamsqueryParamsqueryParams = $", queryParams)
        //     return JSON.parse(decodeURIComponent(queryParams));
        //   }
        // }
      }
    }
  },
  // App was CLOSED and a notification/link launched it (cold start):
  async getInitialURL() {
    // a normal deep link?
    const url = await Linking.getInitialURL();
    if (url) return url;
    // or a tapped push from cold start? read the link out of its data:
    const msg = await getInitialNotification(messaging);
    return (msg?.data?.url as string) ?? null;
  },
  // App was OPEN — listen for live links and notification taps:
  // subscribe(listener) {
  //   const linkSub = Linking.addEventListener('url', ({ url }) => listener(url));
  //   const unsubTap = onNotificationOpenedApp(messaging, (msg) => {
  //     const url = msg?.data?.url;
  //     if (url) listener(url as string);
  //   });
  //   return () => {
  //     linkSub.remove();
  //     unsubTap();
  //   };
  // },

  subscribe(listener: (url: string) => void) {
    const linkLL = Linking.addEventListener('url', ({ url }) => listener(url))
    const unsubTap = onNotificationOpenedApp(messaging, (msg) => {
      const url = msg?.data?.url;
      if (url) listener(url as string);
    });
    return () => {
      linkLL.remove()
      unsubTap()
    }
  }
}

const RootStack = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen name='homeScreen' component={HomeScreen}/>
      <Stack.Screen name='createTask' component={CreateTaskScreen}/>
    </Stack.Navigator>
  )
}

    const { LocalNotif } = NativeModules

setBackgroundMessageHandler(getMessaging(getApp()), async (msg) => {
  console.log('handled in background:', msg.data);
  const title = typeof msg.data?.title === "string"
          ? msg.data.title
          : "";
      
      const body = typeof msg.data?.body === "string"
          ? msg.data.body
          : "";
          const url = typeof msg.data?.url === "string"
          ? msg.data.url
          : undefined;
          // LocalNotif.schedule(title || "", body || "", 1, url)
        })


function App() {
  const [screenType, updateScreenType] = useState('homeScreen')

  useEffect(() => {
    // Foreground: FCM does NOT show a banner automatically — handle it here.
    // const unsub = onMessage(messaging, msg => {
    //   console.log('FCM arrived while app open:', msg.notification?.title, msg.data)
    // })
    // return unsub
  }, [])

  const renderScreen = () => {
    switch (screenType) {
        case 'homeScreen':
            return <HomeScreen />;

        // case 'createTask':
        //     return <CreateTaskScreen />;

        default:
            return <HomeScreen />;
    }
};

  return (
    // <SafeAreaProvider>
      <AppContext.Provider value={{
        type: screenType,
        updateScreenType
      }}>
        <NavigationContainer linking={linking} fallback = {
          <Text>loading...</Text>
        }>
          <RootStack />
        </NavigationContainer>
        {/* <View style = {styles.container}>
            {renderScreen()}
          </View> */}
        </AppContext.Provider>
    // </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    // padding: 100,
    flex: 1,
  },
});

export default App;
