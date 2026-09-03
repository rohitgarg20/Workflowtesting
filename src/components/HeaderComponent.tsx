import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { strConstants } from "../constants/Strings";
import { colors } from "../constants/Colors";

export const HeaderComponent = () => {
    return (
        <View style = {styles.headerContainer}>
            <Text style = {styles.titleLabel}>{strConstants.HEADER_TITLE}</Text>
            <View style = {styles.roundedContainer}>
            <Image 
                source={require("../assets/images/sleep-mode.png")}
                style = {styles.darkModeContainer}
            />
            </View>
        </View>
    )
}

export const styles = StyleSheet.create({
    headerContainer: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    titleLabel: {
        fontWeight: '800',
        fontSize: 22,
        lineHeight: 28,
        color: colors.blackColor
    },
    roundedContainer: {
        height: 40,
        width: 40,
        borderRadius: 100,
        alignContent: 'center'
    },
    darkModeContainer: {
        height: 25,
        width: 25
    }
})