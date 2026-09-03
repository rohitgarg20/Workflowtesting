import React from "react";
import { StyleSheet, TextInput, TextInputProps, View } from "react-native";
import { colors } from "../constants/Colors";

interface IProps extends TextInputProps {
    placeholderText: string,
    isEditable: boolean
}


export const SearchBarComponent = (props: IProps) => {
    const { placeholderText, placeholderTextColor, isEditable = true, ...restProps } = props
    return(
        <View style={styles.searchBarContainer}>
            <TextInput
                placeholder={placeholderText}
                placeholderTextColor={placeholderTextColor}
                editable={isEditable}
                {...restProps}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    searchBarContainer: {
        width: '100%',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 16,
        borderWidth: 1,
        borderColor: colors.borderColor
    }
})