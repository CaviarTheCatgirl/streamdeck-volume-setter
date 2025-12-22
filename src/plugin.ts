import streamDeck from '@elgato/streamdeck';
import { VolumeToggleAction } from './actions/volume-toggle-action';

// Register actions
streamDeck.actions.registerAction(new VolumeToggleAction());

// Connect to Stream Deck
streamDeck.connect();