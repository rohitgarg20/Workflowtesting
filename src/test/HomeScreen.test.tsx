jest.mock('react-native-mmkv');

import { render, screen } from "@testing-library/react-native"
import { HomeScreen } from "../screens/HomeScreen"


it("home screen should render correct", () => {
    render(<HomeScreen/>)
    expect(screen).toBeTruthy()
})