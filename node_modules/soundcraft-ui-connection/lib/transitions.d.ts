import { Observable } from 'rxjs';
import { MixerConnection } from './mixer-connection';
import { Easings } from './utils/transitions/easings';
/**
 * Meta info object for a fade transition
 */
export interface TransitionSource {
    targetValue: number;
    fadeTime: number;
    easing: Easings;
    fps: number;
}
/**
 * Create a stream of fader values based on a stream of transition sources
 * @param transitionSources$ Stream of transition source objects
 * @param faderLevel$ Stream of fader levels. This will be used as the source value for each incoming transition
 * @param conn MixerConnection
 */
export declare function sourcesToTransition(transitionSources$: Observable<TransitionSource>, faderLevel$: Observable<number>, conn: MixerConnection): Observable<number>;
/**
 * Generate discrete steps for a transition
 * @param sourceValue current value of the fader ("where to fade from")
 * @param targetValue target value of the fader ("where to fade to")
 * @param fadeTime fade time in milliseconds
 * @param easing Easing function info, one of the "Easings" enum
 * @param fps frames per seconds
 */
export declare function generateTransition(sourceValue: number, targetValue: number, fadeTime: number, easing: Easings, fps: number): Observable<number>;
