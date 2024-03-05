/* *
 * This Alexa Skill plays a random album for a given artist and may be used as helper for kids to play 
 * an audio book.
 *
 * License: Apache 2.0
 * Author: Tobias Haf
 * */
const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const axios = require('axios');
const qs = require('querystring');
const ddbAdapter = require('ask-sdk-dynamodb-persistence-adapter');

var session = null;
var artist = null;

const fetachAlbums = async (access_token, search_url, albums) => {

    const config = {
        headers: {
            'Authorization': `Bearer ${access_token}`
        }
    }
    var response = await axios.get(search_url, config).then(resp => resp.data);
        
    for (const album of response.albums.items) {
        albums.push(album);
    }

    while (response.albums.next !== null && response.albums.items.length > 0) {  
        response = await axios.get(response.albums.next, config).then(resp => resp.data);
        for (const album of response.albums.items) {
            albums.push(album);
        }
    } 
}

const getDevices = async(access_token) => {

    const config = {
        headers: {
            'Authorization': `Bearer ${access_token}`
        }
    }
    
    const deviceUrl = 'https://api.spotify.com/v1/me/player/devices';
    
    var response = await axios.get(deviceUrl, config).then(resp => resp.data);
    console.log("Available devices: " + JSON.stringify(response.devices));
    return response.devices;
    
}

const getDeviceId = async (deviceName, access_token) => {
    
    const config = {
        headers: {
            'Authorization': `Bearer ${access_token}`
        }
    }
    
    const deviceUrl = 'https://api.spotify.com/v1/me/player/devices';
    
    var response = await axios.get(deviceUrl, config).then(resp => resp.data);
    console.log("devices");
    if (response.devices.length > 1) {
        for (const device of response.devices) {
            console.log(device);
            if (device.name === deviceName) {
                return device;
            }
        }
    } else if (response.devices.length === 1) {
        console.log(response.devices[0]);
        return response.devices[0];
    } else {
        return null;
    }
}

const getPlayerState = async(access_token) => {
    
    const config = {
        headers: {
            'Authorization': `Bearer ${access_token}`
        }
    }
    
    const playerUrl = 'https://api.spotify.com/v1/me/player';
    var response = await axios.get(playerUrl, config).then(resp => resp.data);
    return {
        "albumId": response.item.id,
        "albumName": response.item.album.name,
        "contextUri": response.context.uri,
        "track": response.item.track_number,
        "offset": response.progress_ms
    };
}

const pausePlayer = async(access_token) => {
     const config = {
        headers: {
            'Authorization': `Bearer ${access_token}`
        }
    }
    
    const playerUrl = 'https://api.spotify.com/v1/me/player/pause';
    return await axios.put(playerUrl, {},config);
}

const pausePlayerAndSaveState = async(access_token, attributesManager) => {
    
    const playerState = await getPlayerState(access_token);
    console.log("current player state: " + JSON.stringify(playerState));
    session.playerState = playerState;
    
    let attributes = {};
    attributes.session = session;
    attributesManager.setPersistentAttributes(attributes);
    await attributesManager.savePersistentAttributes();
    
    pausePlayer(access_token);
    
}

const playRandomAlbum = async(artist, access_token) => {


    const searchQuery = {
        'q': artist,
        'type': 'album',
        'market': 'DE',
        'limit': 50,
        'offset':0
    }
    
    var albums = [];
    const search_url = 'https://api.spotify.com/v1/search?' + qs.stringify(searchQuery);
    await fetachAlbums(access_token, search_url, albums);
    console.log("found " + albums.length + " albums");

    if (albums.length === 0) {
        return null;
    }

    const random = Math.floor(Math.random() * albums.length);
    var pickedAlbum = albums[random];
    console.log("playing album '" + pickedAlbum.name + "'");
    return pickedAlbum;
}

const initSession = async(attributesManager, access_token) => {
    
    const attributes = await attributesManager.getPersistentAttributes() || {};

    session = attributes.hasOwnProperty('session') ? attributes.session : null;
    
    const devices = await getDevices(access_token);
    if (session === null) {
        console.log("no session found - creating new one");
        
        if (devices === undefined || devices.length === 0) {
            return -1;
        } else {
            session = {
                "deviceId": devices[0].id,
                "deviceName": devices[0].name
            }
        }
    } else {
        console.log("found existing session: " + JSON.stringify(session));
        let deviceFound = false;
        for (const device of devices) {
            if (session.deviceId === device.id) {
                deviceFound = true;
                break;
            }
        }
        if (deviceFound === false) {
            console.log("configured output device " + session.deviceName + " not found");
            return -2;
        }
        
    }
    return 0;
}

const playRandomAlbumByArtist = async(artist, accessToken, attributesManager) => {
    if (session === null) {
                
        const sessionRc = await initSession(attributesManager, accessToken);

        if (sessionRc === -1) {            
            return "Keine verbundenen Spotify Geräte gefunden. Bitte zunächst Spotify Skill aktivieren."
        } else if (sessionRc === -2) {
            return 'Konfiguriertes Ausgabegerät ' + session.deviceName + ' nicht verfügbar. Bitte Spotify auf dem Geröt aktivieren oder Skill neu konfigurieren.';
        }
    }

    console.log("requested artist: " + artist);
    
    
    try {
        const pickedAlbum = await playRandomAlbum(artist, accessToken);
        
       if (pickedAlbum === null) {
            return "Keine Hörspiele von " + artist + "gefunden. Bitte versuche es noch einmal!";
        }
        console.log("pickedAlbum: " + JSON.stringify(pickedAlbum));
        
        const playQuery = {
            context_uri: pickedAlbum.uri
            
        }
        const play_url = 'https://api.spotify.com/v1/me/player/play?device_id=' + session.deviceId;
    
        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        }
    
        var response = axios.put(play_url, playQuery, config);
        console.log("Erfolgreich geputtet");
        return 'Spiele ' + pickedAlbum.name + ' auf ' + session.deviceName;
        
    } catch (error) {
        console.error(error);
        if (error.response.status === 401) {
            return "Etwas stimmt mit dem Spotify Account nicht. Bitte Account in den Skill Einstellungen neu verknüpfen.";
        } else {
            return "Autsch - hier funktioniert etwas nicht. Bitte versuche es noch einmal." ;
        }
    }

}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        
        try {
            const attributesManager = handlerInput.attributesManager;
            const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
            console.log("AccessToken: " + accessToken);
            if (accessToken === undefined) {
                return handlerInput.responseBuilder
                    .speak("Willkommen bei Mein Hörspiel! Kein Spotify Token gefunden. Bitte Skill zunächst mit Spotify Konto verknüpfen.")
                    .withLinkAccountCard()
                    .getResponse();
            }
            
            const sessionRc = await initSession(attributesManager, accessToken);
            
            console.log("sessionRC = " + sessionRc);

            if (sessionRc === -1) {            
                return handlerInput.responseBuilder
                    .speak("Willkommen bei Mein Hörspiel! Keine verbundenen Spotify Geräte gefunden. Bitte zunächst Spotify Skill aktivieren.")
                     .withShouldEndSession(true)
                    .getResponse();
            } else if (sessionRc === -2) {
                return handlerInput.responseBuilder
                    .speak('Willkommen bei Mein Hörspiel. Konfiguriertes Ausgabegerät ' + session.deviceName + ' nicht verfügbar. Bitte Spotify auf dem Gerät aktivieren oder Skill neu konfigurieren.')
                    .getResponse();        
            }
            
            const speakOutput = 'Willkommen bei Mein Hörspiel!';
    
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt()
                .getResponse();
        } catch (error) {
            console.error(error);
            return handlerInput.responseBuilder
                .speak("Autsch - hier funktioniert etwas nicht. Bitte versuche es noch einmal.")
                .getResponse();
        }
    }
};


const PlayRandomAlbumIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayRandomAlbum';
    },
    async handle(handlerInput) {
        artist = handlerInput.requestEnvelope.request.intent.slots.artist.value;
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        
        const speakOutput = await playRandomAlbumByArtist(artist, accessToken, handlerInput.attributesManager);
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};


const StartedDeviceConfigurationHandler = {
    canHandle(handlerInput) {
        console.log(JSON.stringify(handlerInput));
        const handleit = Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfigureDevice'
            && Alexa.getDialogState(handlerInput.requestEnvelope) === 'STARTED';
        return handleit;
    },

   async handle(handlerInput) {
       try {
            const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
            const devices = await getDevices(accessToken);
            
            if (devices === undefined || devices.length === 0) {
                return handlerInput.responseBuilder
                    .speak("Keine verbundenen Spotify Geräte gefunden. Bitte Spotify Skill aktivieren.")
                    .getResponse();
            }
            
            var deviceString = "";
            var i = 1;
            for (const device of devices) {
                deviceString += " " + (i++) + ": " + device.name + ";";
            }
            
            return handlerInput.responseBuilder
                .speak('Ich habe folgende Geräte gefunden - bitte jeweils die Nummer merken: ' + deviceString + '. Welches Gerät soll verwendet werden? Bitte sage mir die Nummer!')
                .reprompt('Welche Nummer?')
                .addElicitSlotDirective('deviceIndex')
                .getResponse();    
       } catch (error) {
           console.error(error);
           return handlerInput.responseBuilder
            .speak("Etwas ist schief gelaufen")
            .getResponse();
       }
    }
}

const InProgressDeviceConfigurationHandler = {
    canHandle(handlerInput) {
        console.log(JSON.stringify(handlerInput));
        const handleit = Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfigureDevice'
            && handlerInput.requestEnvelope.request.intent.slots.deviceIndex.value 
            && Alexa.getDialogState(handlerInput.requestEnvelope) === 'IN_PROGRESS';
        return handleit;
    },

    handle(handlerInput) {
        return handlerInput.responseBuilder
       .addDelegateDirective()
          .getResponse();
    }
}


const ConfigureDeviceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfigureDevice'
            && handlerInput.requestEnvelope.request.dialogState === 'COMPLETED'
    },
    async handle(handlerInput) { 
        const deviceIndex = handlerInput.requestEnvelope.request.intent.slots.deviceIndex.value 

        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        const devices = await getDevices(accessToken);
        
        if (devices !== undefined && devices.length >= deviceIndex) {
            var usedDevice = devices[deviceIndex-1];
            
            /* store configured device */
            const attributesManager = handlerInput.attributesManager;
            if (session === null) {
                session = {
                    "session": {
                        "deviceId": usedDevice.id,
                        "deviceName": usedDevice.name
                    }
                };
            } else {
                session.deviceId = usedDevice.id;
                session.deviceName = usedDevice.name;
            }
            attributesManager.setPersistentAttributes(session);
            
            console.log("Konfiguration gespeichert: " + JSON.stringify(session));

            await attributesManager.savePersistentAttributes();
            
            return handlerInput.responseBuilder
                .speak("Gerät erfolgreich konfiguriert. Verwende ab jetzt " + session.deviceName)
                .getResponse();    
        } else {
            return handlerInput.responseBuilder
                .speak("Fehler beim Einrichten des Geräts. Bitte versuche es noch einmal!")
                .getResponse();    
        }

        
    }
   
};




/**
 * Intent handler to start playing an audio file.
 * By default, it will play a specific audio stream.
 * */
const PauseAudioIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PauseIntent';
    },
    async handle(handlerInput) {
        console.log("Pause requested");
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        try {
            pausePlayerAndSaveState(accessToken, handlerInput.attributesManager);
            
            return handlerInput.responseBuilder
            .addAudioPlayerStopDirective()
            .getResponse();
        } catch (error) {
            console.error(error);
            return handlerInput.responseBuilder
                .speak("Autsch - hier funktioniert etwas nicht. Bitte versuche es noch einmal.")
                .getResponse();
        }
    }
};

const ResumeAudioIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ResumeIntent';
    },
    async handle(handlerInput) {
        console.log("Resume requested");
        
        if (session === null || session.playerState === undefined) {
            return handlerInput.responseBuilder
                .speak("Nichts zum Fortsetzen gefunden. Bitte starte ein neues Hörspiel.")
                .getResponse();
        }
        
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        try {
            const playQuery = {
                context_uri: session.playerState.contextUri,
                offset: {
                    position: session.playerState.track - 1   
                },
                position_ms: session.playerState.offset
            }
            const play_url = 'https://api.spotify.com/v1/me/player/play?device_id=' + session.deviceId;
        
            const config = {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        
            var response = axios.put(play_url, playQuery, config);
            
            return handlerInput.responseBuilder
            .getResponse();
        } catch (error) {
            console.error(error);
            return handlerInput.responseBuilder
                .speak("Autsch - hier funktioniert etwas nicht. Bitte versuche es noch einmal.")
                .getResponse();
        }
    }
};



const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        try {
            pausePlayerAndSaveState(accessToken, handlerInput.attributesManager);
        } catch (error) {
            console.error(error);
            return handlerInput.responseBuilder
            .speak("Fehler beim Beenden....")
            .getResponse();    
        }
        
        const speakOutput = 'Bis zum nächsten Mal!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Mit mir kannst du eine zufällige Hörspielfolge einer bestimmten Hörspielserie anhören. Sage dazu einfach "Spiele eine Folge von " und füge den Namen der gewünschten Serie an. ' +
                            'Beispiel: Spiele eine Folge Bibi Blocksberg. Gefällt dir eine gewählte Folge nicht kannst du mit "Andere Folge" eine andere Folge der gewählten Serie starten.' +
                            'Wenn du mehrere Geräte bei Spotify angemeldet hast kannst du über den Befehl "Konfiguriere Ausgabegerät" festlegen, auf welchem Gerät die Hörspielserie ' +
                            'abgespielt wird. Viel Spaß!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const PlayAnotherRandomAlbumIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayAnotherRandomAlbum';
    },
    async handle(handlerInput) {
        if (artist === null) {
            return handlerInput.responseBuilder
            .speak("Bitte zunächst eine Folge starten!")
            .getResponse();    
        }
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        const speakOutput = await playRandomAlbumByArtist(artist, accessToken, handlerInput.attributesManager);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Entschuldigung - das habe ich nicht verstanden. Bitte sage zum Beispiel: Spiele eine Folge von Bibi Blocksberg';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

/**
 * Intent handler for built-in intents that aren't supported in this sample skill.
 * As this is a sample skill for a single stream, these intents are irrelevant to this skill.
 * Regardless, the skill needs to handle this gracefully, which is why this handler exists.
 * */
const UnsupportedAudioIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (
                Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.LoopOffIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.LoopOnIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NextIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PreviousIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.RepeatIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ShuffleOffIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ShuffleOnIntent'
                    || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StartOverIntent'
                );
    },
    async handle(handlerInput) {
        const speakOutput = 'Entschuldigung - den Befehl unterstütze ich momentan nicht.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();
  return attributes.playbackInfo;
}

async function setPlaybackInfo(handlerInput, playbackInfoObject) {
  await handlerInput.attributesManager.setPersistentAttributes({
      playbackInfo: playbackInfoObject
      });
}


/* *
 * AudioPlayer events can be triggered when users interact with your audio playback, such as stopping and 
 * starting the audio, as well as when playback is about to finish playing or playback fails.
 * This handler will save the appropriate details for each event and log the details of the exception,
 * which can help troubleshoot issues with audio playback.
 * */
const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type.startsWith('AudioPlayer.');
  },
  async handle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    
    const audioPlayerEventName = handlerInput.requestEnvelope.request.type.split('.')[1];
    console.log(`AudioPlayer event encountered: ${handlerInput.requestEnvelope.request.type}`);
    let returnResponseFlag = false;
    switch (audioPlayerEventName) {
      case 'PlaybackStarted':
        playbackInfo.token = handlerInput.requestEnvelope.request.token;
        playbackInfo.inPlaybackSession = true;
        playbackInfo.hasPreviousPlaybackSession = true;
        returnResponseFlag = true;
        break;
      case 'PlaybackFinished':
        playbackInfo.inPlaybackSession = false;
        playbackInfo.hasPreviousPlaybackSession = false;
        playbackInfo.nextStreamEnqueued = false;
        returnResponseFlag = true;
        break;
      case 'PlaybackStopped':
        playbackInfo.token = handlerInput.requestEnvelope.request.token;
        playbackInfo.inPlaybackSession = true;
        playbackInfo.offsetInMilliseconds = handlerInput.requestEnvelope.request.offsetInMilliseconds;
        break;
      case 'PlaybackNearlyFinished':
        break;
      case 'PlaybackFailed':
        playbackInfo.inPlaybackSession = false;
        console.log('Playback Failed : %j', handlerInput.requestEnvelope.request.error);
        break;
      default:
        break;
    }
    setPlaybackInfo(handlerInput, playbackInfo);
    return handlerInput.responseBuilder.getResponse();
  },
};

/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Entschuldigung - hier ist etwas kaputt gegangen. Versuchen wir es noch einmal. Bitte sage zum Beispiel: Spiele eine Folge von Bibi Blocksberg';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)} `);
        console.log(`~~~~ handlerInput: ${JSON.stringify(handlerInput)} `);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};


/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        HelpIntentHandler,
        PlayRandomAlbumIntentHandler,
        PlayAnotherRandomAlbumIntentHandler,
        StartedDeviceConfigurationHandler,
        ConfigureDeviceIntentHandler,
        InProgressDeviceConfigurationHandler,
        PauseAudioIntentHandler,
        ResumeAudioIntentHandler,
        UnsupportedAudioIntentHandler,
        AudioPlayerEventHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withCustomUserAgent('meinhoerspiel/v1.0')
    .withPersistenceAdapter(
        new ddbAdapter.DynamoDbPersistenceAdapter({
            tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
            createTable: false,
            dynamoDBClient: new AWS.DynamoDB({apiVersion: 'latest', region: process.env.DYNAMODB_PERSISTENCE_REGION})
        }))
    .lambda();