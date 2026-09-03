import React, { useContext, useReducer,  } from "react";
import { Button, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../constants/Colors";
import { ITaskDetailCard, TaskPriority, TaskPriorityMap, TaskType } from "../constants/Constant";
import { SearchBarComponent } from "../components/SearchBar";
import { strConstants } from "../constants/Strings";
import { storage } from "../mmkv/storage";
import { AppContext } from "../Context";

interface IFormState {
    taskTitle: string,
    description: string,
    taskPriorty: TaskPriority
}

enum Action {
    addTitle = 'addTitle',
    addDescription = 'addDescription',
    addPriority = 'addPriority',
    clear = 'clear'
}

type IAction = | {
    type: Action.addTitle,
    payload: string
} | {
    type: Action.addDescription,
    payload: string
} | {
    type: Action.addPriority,
    taskPriority: TaskPriority
} | {
    type: Action.clear
}


const initialState: IFormState = {
    taskTitle: '',
    description: '',
    taskPriorty: TaskPriority.NONE
}

const reducer = (state: IFormState, action: IAction): IFormState => {
    switch(action.type) {
        case Action.addTitle: {
            return {
                ...state,
                taskTitle: action.payload
            }
        }
        case Action.addDescription: {
            return {
                ...state,
                description: action.payload
            }
        }
        case Action.addPriority: {
            return {
                ...state,
                taskPriorty: action.taskPriority
            }
        }
        case Action.clear: {
            return {
                ...initialState
            }
        }
        default: {
            return state
        }
    }
}


export const CreateTaskScreen = ({ route }) => {
    const { name, tab } = route.params ?? {};
    console.log(route.params)
    const[state, dispatch] = useReducer(reducer, initialState)
    const { updateScreenType } = useContext(AppContext)

    const onChangeTitleText = (text: string) => {
        dispatch({
            type: Action.addTitle,
            payload: text
        })
    }

    const onChangeDescriptionText = (text: string) => {
        dispatch({
            type: Action.addDescription,
            payload: text
        })
    }

    const saveTask= () => {
        const initialTaskList = storage.getString("task_list")
        const currentTask = {
            title: state.taskTitle,
            description: state.description,
            timeStamp: new Date(),
            priority: state.taskPriorty,
            status: TaskType.Active
        }
        if (initialTaskList && initialTaskList.length > 0) {
            const parsedData = JSON.parse(initialTaskList);
            console.log('parsedDataparsedData', parsedData);
            const taskList: ITaskDetailCard[] = [
                currentTask,
                ...parsedData
            ]
            storage.set("task_list", JSON.stringify(taskList))
        } else {
            storage.set("task_list", JSON.stringify([currentTask]))
        }
        dispatch({
            type: Action.clear
        })
    }

    return (
        <ScrollView style = {{ flex: 1 }} contentContainerStyle={styles.mainContainer}>
            <View>
                <Text>{strConstants.TASK_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.TASK_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeTitleText}
                    value={state.taskTitle}
                />
            </View>
            <View>
                <Text>{strConstants.DESCRIPTION_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.DESCRIPTION_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeDescriptionText}
                    value={state.description}
                />
            </View>
            {/* <View>
                <Text>{strConstants.TASK_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.TASK_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeTitleText}
                    value={state.taskTitle}
                />
            </View>
            <View>
                <Text>{strConstants.DESCRIPTION_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.DESCRIPTION_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeDescriptionText}
                    value={state.description}
                />
            </View>
            <View>
                <Text>{strConstants.TASK_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.TASK_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeTitleText}
                    value={state.taskTitle}
                />
            </View>
            <View>
                <Text>{strConstants.DESCRIPTION_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.DESCRIPTION_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeDescriptionText}
                    value={state.description}
                />
            </View>
            <View>
                <Text>{strConstants.TASK_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.TASK_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeTitleText}
                    value={state.taskTitle}
                />
            </View>
            <View>
                <Text>{strConstants.DESCRIPTION_TITLE}</Text>
                <SearchBarComponent
                    placeholderText={strConstants.DESCRIPTION_TITLE_PL}
                    placeholderTextColor={colors.secondaryText}
                    isEditable={true}
                    onChangeText={onChangeDescriptionText}
                    value={state.description}
                />
            </View> */}
            <View>
                <Text>{strConstants.PRIORTY}</Text>
                <View style={styles.priorityRowContainer}>
                    {
                        [...TaskPriorityMap].map((entry) => {
                            return (
                                <TouchableOpacity onPress={() =>
                                    dispatch({
                                        type: Action.addPriority,
                                        taskPriority: entry[0]
                                    })
                                }>
                                    <Text>{entry[1].label}</Text>
                                </TouchableOpacity>
                            )
                        })
                    }
                </View>
            </View>
            <Button title="Save" onPress={saveTask}/>

             <Pressable onPress={() => {
                                        updateScreenType('homeScreen')
                                    }}>
                                        <Text>Home Screen</Text>
                                    </Pressable>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    mainContainer: {
        flexGrow: 1,
        backgroundColor: colors.lightBlue,
        padding: 20
    },
    priorityRowContainer: {
        flex: 1,
        flexDirection: 'row',
        columnGap: 10
    },
    priorityContainer: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.borderColor
    }
})