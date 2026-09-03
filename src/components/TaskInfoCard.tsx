import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../constants/Colors";

interface IProps {
    taskHeading: number,
    taskSubHeading: string,
    icon: string,
    isTotalTaskContainer: boolean
}


export const TaskInfoCard = (props: IProps) => {
    const { isTotalTaskContainer, taskHeading, taskSubHeading, icon } = props
    const getContainerColor = useMemo(() => {
        return {
            ...styles.roundedContainer,
            backgroundColor: isTotalTaskContainer ? colors.backgroundColor : colors.lightGreen
        }
    }, [isTotalTaskContainer])
    return (
        <View style={styles.cardContainer}>
            <View style={getContainerColor}>
                {/* <Image
                    src={icon}
                    style={styles.iconStyle}
                /> */}
            </View>
            <View style={styles.infoContainer}>
                <Text style={styles.title}>{taskHeading}</Text>
                <Text style={styles.subTitle}>{taskSubHeading}</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    cardContainer: {
        flex: 1,
        padding: 20,
        alignContent: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.borderColor,
        elevation: 10,
        shadowColor: colors.shadowColor,
        shadowRadius: 2,
        flexDirection: 'row',
        rowGap: 8
    },
    roundedContainer: {
        height: 32,
        width: 32,
        borderRadius: 32,
        alignContent: 'center'
    },
    title: {
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '600',
        color: colors.blackColor
    },
    subTitle: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
        color: colors.secondaryText
    },
    infoContainer: {
        flexDirection: 'column',
        columnGap: 10
    },
    iconStyle: {
        height: 24,
        width: 24,
    }
})