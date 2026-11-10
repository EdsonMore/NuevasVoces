export declare enum Easings {
    Linear = 0,
    EaseIn = 1,
    EaseOut = 2,
    EaseInOut = 3
}
export declare const easingFunctions: {
    [key in Easings]: (t: number) => number;
};
