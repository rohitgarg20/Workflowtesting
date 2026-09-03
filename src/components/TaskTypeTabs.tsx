import React, { useCallback } from "react";
import { FlatList, StyleSheet, View, Text, useWindowDimensions, TouchableOpacity } from "react-native";
import { ITaskType, TasksList, TaskType } from "../constants/Constant";
import { colors } from "../constants/Colors";

export const TaskTypeTabs = ({ selectedTab, onClickTab }: { selectedTab: TaskType, onClickTab: (taskType: TaskType) => void }) => {
    const { width } = useWindowDimensions();
    const itemSize = (width - 24) / 3;
    const getKeyExtractor = useCallback((item: ITaskType) => {
        return item.id
    }, [])

    const getTabStyle = useCallback((tab: TaskType) => {
        return {
            ...styles.tabItem,
            backgroundColor: selectedTab === tab ? colors.primaryBlue : colors.borderColor,
            borderRadius: 24,
            width: itemSize
        }
    }, [selectedTab, itemSize])

    const renderItem = ({ item }: { item: ITaskType }) => {
        const { id, displayLabel  } = item
        return(
            <TouchableOpacity 
                style={getTabStyle(id)}
                onPress={() =>
                    onClickTab(id)
                }
            >
                <Text style={styles.itemLabel}>{displayLabel}</Text>
            </TouchableOpacity>
        )
    }

    return(
            <FlatList
                style={{
                    flexGrow: 0
                }}
                data={TasksList}
                renderItem={renderItem}
                keyExtractor={getKeyExtractor}
                horizontal
                contentContainerStyle={styles.contentContainer}
            />
    )
}

const styles = StyleSheet.create({
    contentContainer: {
        width: '100%',
        backgroundColor: colors.borderColor,
        height: 50,
        borderRadius: 24,
    },
    tabItem: {
        height: '100%',
        alignContent: 'center',
        justifyContent: 'center',
        alignItems: 'center'
    },
    itemLabel: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '400',
        color: colors.blackColor
    }
})