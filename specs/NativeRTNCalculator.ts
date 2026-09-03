import { TurboModule, TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
    add: (a: number, b: number) => Promise<number>;
    reverseString: (str: string) => string;
    promisesNumber: () => Promise<number>;
    callMeLater: (successCb: () => void, failureCB: () => void) => void;
}

export default TurboModuleRegistry.get<Spec>("RTNCalculator") as Spec | null;