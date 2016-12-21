/**
 * This sample shows how to create a Lambda function for handling Alexa Skill requests that:
 * - Web service: communicate with an external web service to get tide data from NOAA CO-OPS API (http://tidesandcurrents.noaa.gov/api/)
 * - Multiple optional slots: has 2 slots (city and date), where the user can provide 0, 1, or 2 values, and assumes defaults for the unprovided values
 * - DATE slot: demonstrates date handling and formatted date responses appropriate for speech
 * - Custom slot type: demonstrates using custom slot types to handle a finite set of known values
 * - Dialog and Session state: Handles two models, both a one-shot ask and tell model, and a multi-turn dialog model.
 *   If the user provides an incorrect slot in a one-shot model, it will direct to the dialog model. See the
 *   examples section for sample interactions of these models.
 * - Pre-recorded audio: Uses the SSML 'audio' tag to include an ocean wave sound in the welcome response.
 *
 * Examples:
 * One-shot model:
 *  User:  "Alexa, ask Tide Pooler when is the high tide in Seattle on Saturday"
 *  Alexa: "Saturday June 20th in Seattle the first high tide will be around 7:18 am,
 *          and will peak at ...""
 * Dialog model:
 *  User:  "Alexa, open Tide Pooler"
 *  Alexa: "Welcome to Tide Pooler. Which city would you like tide information for?"
 *  User:  "Seattle"
 *  Alexa: "For which date?"
 *  User:  "this Saturday"
 *  Alexa: "Saturday June 20th in Seattle the first high tide will be around 7:18 am,
 *          and will peak at ...""
 */

/**
 * App ID for the skill
 */
var APP_ID = undefined;//replace with 'amzn1.echo-sdk-ams.app.[your-unique-value-here]';

var http = require('http');

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * FandangoSkill is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var FandangoSkill = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
FandangoSkill.prototype = Object.create(AlexaSkill.prototype);
FandangoSkill.prototype.constructor = FandangoSkill;

// ----------------------- Override AlexaSkill request and intent handlers -----------------------

FandangoSkill.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any initialization logic goes here
};

FandangoSkill.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleWelcomeRequest(response);
};

FandangoSkill.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

/**
 * override intentHandlers to map intent handling functions.
 */
FandangoSkill.prototype.intentHandlers = {
    "OneshotTheaterIntent": function (intent, session, response) {
        handleOneshotTheaterRequest(intent, session, response);
    },

    "DialogTheaterIntent": function (intent, session, response) {
        // Determine if this turn is for zipcode, for type, or an error.
        // We could be passed slots with values, no slots, slots with no value.
        var zipcodeSlot = intent.slots.Zipcode;
        var typeSlot = intent.slots.Type;
        if (zipcodeSlot && zipcodeSlot.value) {
            handleZipcodeDialogRequest(intent, session, response);
        } else if (typeSlot && typeSlot.value) {
            handleDateDialogRequest(intent, session, response);
        } else {
            handleNoSlotDialogRequest(intent, session, response);
        }
    },

    "SupportedZipcodesIntent": function (intent, session, response) {
        handleSupportedZipcodesRequest(intent, session, response);
    },

    "AMAZON.HelpIntent": function (intent, session, response) {
        handleHelpRequest(response);
    },

    "AMAZON.StopIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    }
};

// -------------------------- FandangoSkill Domain Specific Business Logic --------------------------

var TYPES = {
    'movies': 'movies',
    'theaters': 'theaters'
};

var whichZipPrompt = "Which zipcode would you like movie information for?";
var speechPrompt = "I can lead you through providing a zipcode "
    + "to get movie information, "
    + "or you can simply open Fandango and ask a question like, "
    + "get movie information for 63101. "
    + "Or you can say exit. "
    + whichZipPrompt;
var zipInfoPrompt = "Currently, I know movie information by zipcode. " + whichZipPrompt;

function handleWelcomeRequest(response) {
    var speechOutput = {
            speech: "<speak>Welcome to Fandango. "
                + whichZipPrompt
                + "</speak>",
            type: AlexaSkill.speechOutputType.SSML
        },
        repromptOutput = {
            speech: speechPrompt,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };

    response.ask(speechOutput, repromptOutput);
}

function handleHelpRequest(response) {
    response.ask(speechPrompt, whichZipPrompt);
}

/**
 * Handles the case where the user needs help with zipcodes
 */
function handleSupportedZipcodesRequest(intent, session, response) {
    // get zipcode re-prompt
    response.ask(zipInfoPrompt, whichZipPrompt);
}

/**
 * Handles the dialog step where the user provides a zipcode
 */
function handleCityDialogRequest(intent, session, response) {

    var cityStation = getZipcodeFromIntent(intent, false),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        repromptText = zipInfoPrompt;
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;
        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a date yet, go to date. If we have a date, we perform the final request
    if (session.attributes.date) {
        getFinalTideResponse(cityStation, session.attributes.date, response);
    } else {
        // set city in session and prompt for date
        session.attributes.city = cityStation;
        speechOutput = "For which date?";
        repromptText = "For which date would you like tide information for " + cityStation.city + "?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handles the dialog step where the user provides a date
 */
function handleDateDialogRequest(intent, session, response) {

    var date = getDateFromIntent(intent),
        repromptText,
        speechOutput;
    if (!date) {
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like tide information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a city yet, go to city. If we have a city, we perform the final request
    if (session.attributes.city) {
        getFinalTideResponse(session.attributes.city, date, response);
    } else {
        // The user provided a date out of turn. Set date in session and prompt for city
        session.attributes.date = date;
        speechOutput = "For which city would you like tide information for " + date.displayDate + "?";
        repromptText = "For which city?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handle no slots, or slot(s) with no values.
 * In the case of a dialog based skill with multiple slots,
 * when passed a slot with no value, we cannot have confidence
 * it is the correct slot type so we rely on session state to
 * determine the next turn in the dialog, and reprompt.
 */
function handleNoSlotDialogRequest(intent, session, response) {
    if (session.attributes.zipcode) {
        // get date re-prompt
        var repromptText = "Please try again saying a day of the week, for example, Saturday. ";
        var speechOutput = repromptText;

        response.ask(speechOutput, repromptText);
    } else {
        // get zipcode re-prompt
        handleSupportedZipsRequest(intent, session, response);
    }
}

/**
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Tide Pooler and get tide information for Seattle on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotTheaterRequest(intent, session, response) {

    // Determine city, using default if none provided
    var cityStation = getZipcodeFromIntent(intent, true),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        // invalid city. move to the dialog
        repromptText = "Currently, I know tide information for these coastal cities: " + getAllStationsText()
            + "Which city would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // Determine custom date
    var date = getDateFromIntent(intent);
    if (!date) {
        // Invalid date. set city in session and prompt for date
        session.attributes.city = cityStation;
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like tide information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // all slots filled, either from the user or by default values. Move to final request
    getFinalTideResponse(cityStation, date, response);
}

/**
 * Both the one-shot and dialog based paths lead to this method to issue the request, and
 * respond to the user with the final answer.
 */
function getFinalTideResponse(cityStation, date, response) {

    // Issue the request, and respond to the user
    makeTideRequest(cityStation.station, date, function tideResponseCallback(err, highTideResponse) {
        var speechOutput;

        if (err) {
            speechOutput = "Sorry, " + err.message;
        } else {
            speechOutput = date.displayDate + " in " + cityStation.city + ", the first high tide will be around "
                + highTideResponse.firstHighTideTime + ", and will peak at about " + highTideResponse.firstHighTideHeight
                + ", followed by a low tide at around " + highTideResponse.lowTideTime
                + " that will be about " + highTideResponse.lowTideHeight
                + ". The second high tide will be around " + highTideResponse.secondHighTideTime
                + ", and will peak at about " + highTideResponse.secondHighTideHeight + ".";
        }

        response.tellWithCard(speechOutput, "FandangoSkill", speechOutput)
    });
}

/**
 * Uses fandango.com RSS
 * Results can be seen at: http://www.fandango.com/rss/moviesnearme_[zipcode].rss
 */
function makeFandangoRequest(zipcode, type, tideResponseCallback) {

    var endpoint = 'http://www.fandango.com/rss/moviesnearme_'+zipcode+'.rss';

    http.get(endpoint, function (res) {
        var fandangoResponseString = '';
        console.log('Status Code: ' + res.statusCode);

        if (res.statusCode != 200) {
            tideResponseCallback(new Error("Fandango is experiencing difficulties"));
        }

        res.on('data', function (data) {
            fandangoResponseString += data;
        });

        res.on('end', function () {
            parser = new DOMParser();
            var fandangoResponseObject = parser.parseFromString(fandangoResponseString,"text/xml");

            if (fandangoResponseObject.getElementsByTagName("item").length==0) {
                console.log("Fandango error: no results for " + zipcode);
                tideResponseCallback(new Error("No results for " + zipcode));
            } else {
                var highTide = findHighTide(fandangoResponseObject);
                tideResponseCallback(null, highTide);
            }
        });
    }).on('error', function (e) {
        console.log("Communications error: " + e.message);
        tideResponseCallback(new Error(e.message));
    });
}

/**
 * Parse XML response to get movies
 */
function findMovies(fandangoResponseObject) {
    fandangoResponseObject.getElementsByTagName("item");

    return []
}

/**
 * Parse XML response to get theaters
 */
function findTheaters(fandangoResponseObject) {
    fandangoResponseObject.getElementsByTagName("item");

    return []
}


/**
 * Gets the zipcode from the intent, or returns an error
 */
function getZipcodeFromIntent(intent, assignDefault) {

    var citySlot = intent.slots.City;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!citySlot || !citySlot.value) {
        if (!assignDefault) {
            return {
                error: true
            }
        } else {
            // For sample skill, default to Seattle.
            return {
                city: 'seattle',
                station: STATIONS.seattle
            }
        }
    } else {
        // lookup the city. Sample skill uses well known mapping of a few known cities to station id.
        var cityName = citySlot.value;
        if (STATIONS[cityName.toLowerCase()]) {
            return {
                city: cityName,
                station: STATIONS[cityName.toLowerCase()]
            }
        } else {
            return {
                error: true,
                city: cityName
            }
        }
    }
}

/**
 * Gets the type from the intent, defaulting to movies if none provided,
 * or returns an error
 */
function getTypeFromIntent(intent) {
    var typeSlot = intent.slots.Type;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!typeSlot || !typeSlot.value) {
        // default to movies
        return {
            type: "movies"
        }
    } else {
        return {
            type: typeSlot.value
        }
    }
}

function getAllTypesText() {
    var typeList = '';
    for (var type in TYPES) {
        typeList += type + ", ";
    }

    return typeList;
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var fandangoSkill = new FandangoSkill();
    fandangoSkill.execute(event, context);
};

