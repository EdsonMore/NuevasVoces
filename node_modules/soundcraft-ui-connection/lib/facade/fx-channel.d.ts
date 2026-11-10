import { MixerConnection } from '../mixer-connection';
import { MixerStore } from '../state/mixer-store';
import { ChannelType } from '../types';
import { SendChannel } from './send-channel';
/**
 * Represents a channel on an FX bus
 */
export declare class FxChannel extends SendChannel {
    constructor(conn: MixerConnection, store: MixerStore, channelType: ChannelType, channel: number, bus: number);
}
