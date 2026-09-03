import React, { useContext } from "react";
import { StyleSheet, View, Text, Pressable } from "react-native";
import { colors } from "../constants/Colors";
import { ITaskDetailCard, TaskPriorityMap, ITaskPriorityDetail } from "../constants/Constant";
import { AppContext } from "../Context";

interface IProps {
    taskDetailCard: ITaskDetailCard
}

export const TaskDetailCard = (props: IProps) => {
    const { description, priority, timeStamp } = props.taskDetailCard
    const { label, color } = TaskPriorityMap.get(priority) as ITaskPriorityDetail
    const { updateScreenType } = useContext(AppContext)
    return (
        <View style={styles.cardContainer}>
            <View>
                <Text style={styles.title}>{description}</Text>
                {/* <Text style={styles.subtitle}>{timeStamp}</Text> */}
            </View>
            <View style={[styles.priortyView, { backgroundColor: color }]}>
                <Text style={[styles.subtitle, { color: colors.white }]}>{label}</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    cardContainer: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 20,
        borderColor: colors.borderColor,
        // borderWidth: 1,
        backgroundColor: colors.lightBlue,
        elevation: 20,
        shadowRadius: 5
    },
    title: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '800',
        color: colors.blackColor
    },
    subtitle: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
        color: colors.secondaryText
    },
    priortyView: {
        borderRadius: 12,
        padding: 10,
        minWidth: 100,
        alignItems: 'center'
    }
})