import React, { useCallback, useContext, useEffect, useState } from "react";
import { Button, NativeModules, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View, NativeModule } from "react-native";
import { colors } from "../constants/Colors";
import { HeaderComponent } from "../components/HeaderComponent";
import { strConstants } from "../constants/Strings";
import { SearchBarComponent } from "../components/SearchBar";
import { ITaskDetailCard, TaskInfo, TaskKeys, TaskPriority, TaskType } from "../constants/Constant";
import { TaskInfoCard } from "../components/TaskInfoCard";
import { TaskTypeTabs } from "../components/TaskTypeTabs";
import { TaskDetailCard } from "../components/TaskDetailCard";
import { storage } from "../mmkv/storage";
import { AppContext } from "../Context";
import { useDebounce } from "../ussDebounce";
import { getMessaging, onMessage, onNotificationOpenedApp } from "@react-native-firebase/messaging";
import { getApp } from "@react-native-firebase/app";
import NativeRTNCalculator from "../../specs/NativeRTNCalculator";
interface ITaskInfo {
    totalTask: number,
    completedTask: number
}



export const HomeScreen = () => {
    const { LocalNotif } = NativeModules
    const [taskInfo, setTaskCount] = useState<ITaskInfo>({
        totalTask: 0,
        completedTask: 0
    })
    const [query, setQuery] = useState('');
    const {
        filteredList
    } = useDebounce({
        query
    })

    const [selectedTab, updateSelectedTab] = useState<TaskType>(TaskType.All)

    const { updateScreenType } = useContext(AppContext)

    useEffect(() => {
        const taskList = storage.getString("task_list")
        console.log("taskListtaskListtaskList", taskList, filteredList)
        let totalTask = 0
        if (taskList && taskList?.length > 0) {
            totalTask = (JSON.parse(taskList) as ITaskDetailCard[])?.length
        }
        setTaskCount({
            totalTask: totalTask,
            completedTask: 5
        })

    }, [])

    const scheduleReminder = async (title: string, body: string, seconds: number, url?: string) => {
        if (Platform.OS === 'android' && Platform.Version >= 33) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,   // the phone asks the user
          );
        }
        // url = deep link opened on tap; routes through App's `linking` subscribe()
        LocalNotif.schedule(title, body, seconds, url ?? null);
      }

      useEffect(() => {
        const messaging = getMessaging(getApp())
        messaging.getToken().then((tk) => {
          console.log("tktktktktktktktktk", tk)
        })
        const unsub = onMessage(messaging, (msg) => {
          console.log('arrived while open:', msg.notification?.title, msg.notification?.body, msg.data);
          const title = typeof msg.data?.title === "string"
          ? msg.data.title
          : "";
      
      const body = typeof msg.data?.body === "string"
          ? msg.data.body
          : "";
      const url = typeof msg.data?.url === "string"
          ? msg.data.url
          : undefined;
        scheduleReminder(title || "", body || "", 1, url)
        })

        // const onNotifOpened = onNotificationOpenedApp(messaging, (msg) => {
        //     console.log('arrived while clicked:', msg.notification?.title, msg.notification?.body, msg.data);
        // })

        return () => {
            unsub();
            // onNotifOpened();
        }
      }, [])

    

    const TaskDetailContainer = useCallback(() => {
        return (
            <View style={styles.taskListContainer}>
                {
                    (Object.keys(TaskInfo) as TaskKeys[]).map((taskType) => {
                        const { icon, displayLabel } = TaskInfo[taskType]
                        return (
                            <TaskInfoCard
                                taskHeading={taskType === TaskKeys.totalTask ? taskInfo.totalTask : taskInfo.completedTask}
                                icon={icon}
                                taskSubHeading={displayLabel}
                                isTotalTaskContainer={taskType === TaskKeys.totalTask}
                            />
                        )
                    })
                }
            </View>
        )
    }, [taskInfo])


    return (
        <View style={styles.container}>
            <HeaderComponent/>
            <View>
                <Text style={styles.subTitle}>{strConstants.SUBTITLE}</Text>
                <Text style={styles.letsGetThings}>{strConstants.LETS_GET_THINGS_DONE}</Text>
            </View>
            <SearchBarComponent
                placeholderText={strConstants.SEARCH_TEXT}
                placeholderTextColor={colors.secondaryText}
                isEditable={false}
             />
            <TaskDetailContainer/>
            <TaskTypeTabs
                selectedTab={selectedTab}
                onClickTab={ updatedTab => 
                    updateSelectedTab(updatedTab)
                }
            />
            <TaskDetailCard
                taskDetailCard={{
                    description: "Learn React Hooks",
                    priority: TaskPriority.HIGH,
                    timeStamp: new Date(),
                    status: TaskType.Active,
                    title: 'ssdf'
                }}
            />
            <TaskDetailCard
                taskDetailCard={{
                    description: "Learn React Hooks",
                    priority: TaskPriority.HIGH,
                    timeStamp: new Date(),
                    status: TaskType.Active,
                    title: 'ssdf'
                }}
            />
            <TaskDetailCard
                taskDetailCard={{
                    description: "Learn React Hooks",
                    priority: TaskPriority.HIGH,
                    timeStamp: new Date(),
                    status: TaskType.Active,
                    title: 'ssdf'
                }}
            />
            <Pressable onPress={() => {
                updateScreenType('createTask')
            }}>
                <Text>Create Task</Text>
            </Pressable>
            <Pressable onPress={() => {
            NativeRTNCalculator?.add(1, 2).then((result) => {
                    console.log("result", result);
                })
            }}>
                <Text>first method is called</Text>
            </Pressable>
            <Pressable onPress={() => {
                // updateScreenType('createTask')
                const res = NativeRTNCalculator?.reverseString("string")
                console.log("result", res);
            }}>
                <Text>2nd method is called</Text>
            </Pressable>
            <Pressable onPress={() => {
                // updateScreenType('createTask')
                NativeRTNCalculator?.callMeLater(() => {
                    "success cb"
                }, () => {
                    "failure cb"
                })
            }}>
                <Text>3rd method is called</Text>
            </Pressable>
            <Pressable onPress={() => {
                // updateScreenType('createTask')
                NativeRTNCalculator?.promisesNumber()
            }}>
                <Text>4th method is called</Text>
            </Pressable>
            <Button title="Remind me in 5s"
                onPress={() => scheduleReminder('⏰ Reminder', 'This came from your own app!', 5)} />
        </View>
    )


}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.backgroundColor,
        padding: 12,
        flexDirection: 'column',
        rowGap: 12
    },
    subTitle: {
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '600',
        color: colors.blackColor
    },
    letsGetThings: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
        color: colors.secondaryText
    },
    taskListContainer: {
        width: '100%',
        flexDirection: 'row',
        rowGap: 5
    }
})