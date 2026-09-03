import { createContext } from "react";

interface IContextProps {
    type: string,
    updateScreenType: (type: string) => void
}



export const AppContext = createContext<IContextProps>({
    type: 'homeScreen',
    updateScreenType: () => {}
})