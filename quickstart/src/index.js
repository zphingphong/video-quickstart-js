'use strict';

var Video = require('twilio-video');
const colorHash = new (require('color-hash'))();
const dataTrack = new Video.LocalDataTrack();

var activeRoom;
var previewTracks;
var identity;
var roomName;
var canvas;
var participantId;


// Attach the Track to the DOM.
function attachTrack(track, container) {
  if (track.kind === 'audio' || track.kind === 'video') {
    let newParticipantEl = container.appendChild(track.attach());
    let cv = $(`<canvas id="${participantId}"></canvas>`);
    cv.on('click', event => {
      const { offsetX: x, offsetY: y } = event;
      let mouseCoordinates = { x, y };

      const color = colorHash.hex(dataTrack.id);
      drawCircle(cv[0], color, x, y);

      // dataTrack.send(JSON.stringify({
      //   mouseCoordinates
      // }));
    });
    newParticipantEl.appendChild(cv[0]);
    cv[0].width = `100%`;
    cv[0].height = `100%`;
  } else if (track.kind === 'data') {
    const color = colorHash.hex(track.id);
    track.on('message', data => {
      const { mouseCoordinates: { x, y } } = JSON.parse(data);
      drawCircle($(`#${participantId}`), color, x, y);
    });
  }
}

// Attach array of Tracks to the DOM.
function attachTracks(tracks, container) {
  tracks.forEach(function(track) {
    attachTrack(track, container);
  });
}

// Detach given track from the DOM
function detachTrack(track) {
  track.detach().forEach(function(element) {
    element.remove();
  });
}

// A new RemoteTrack was published to the Room.
function trackPublished(publication, container) {
  if (publication.isSubscribed) {
    attachTrack(publication.track, container);
  }
  publication.on('subscribed', function(track) {
    log('Subscribed to ' + publication.kind + ' track');
    attachTrack(track, container);
  });
  publication.on('unsubscribed', detachTrack);
}

// A RemoteTrack was unpublished from the Room.
function trackUnpublished(publication) {
  log(publication.kind + ' track was unpublished.');
}

// A new RemoteParticipant joined the Room
function participantConnected(participant, container) {
  participantId = participant.sid;
  participant.tracks.forEach(function(publication) {
    trackPublished(publication, container);
  });
  participant.on('trackPublished', function(publication) {
    trackPublished(publication, container);
  });
  participant.on('trackUnpublished', trackUnpublished);
}

// Detach the Participant's Tracks from the DOM.
function detachParticipantTracks(participant) {
  var tracks = getTracks(participant);
  tracks.forEach(detachTrack);
}

// When we are about to transition away from this page, disconnect
// from the room, if joined.
window.addEventListener('beforeunload', leaveRoomIfJoined);

// Obtain a token from the server in order to connect to the Room.
$.getJSON('/token', function(data) {
  identity = data.identity;
  document.getElementById('room-controls').style.display = 'block';

  canvas = $('canvas')[0];
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  window.addEventListener('resize', () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  });

  document.getElementById('button-close').onclick = function() {
    if(activeRoom){
      $.getJSON(`/close/${activeRoom.sid}`, function(data) {
        console.log('Rooom closed');
      });
    }
  };

  // Bind button to join Room.
  document.getElementById('button-join').onclick = function() {
    roomName = document.getElementById('room-name').value;
    if (!roomName) {
      alert('Please enter a room name.');
      return;
    }

    log("Joining room '" + roomName + "'...");
    var connectOptions = {
      name: roomName,
      logLevel: 'debug'
    };

    $('canvas').on('click', event => {
      const { offsetX: x, offsetY: y } = event;
      let mouseCoordinates = { x, y };

      const color = colorHash.hex(dataTrack.id);
      drawCircle(canvas, color, x, y);

      dataTrack.send(JSON.stringify({
        mouseCoordinates
      }));
    });

    if (previewTracks) {
      connectOptions.tracks = previewTracks.concat(dataTrack);
      Video.connect(data.token, connectOptions).then(roomJoined, function (error) {
        log('Could not connect to Twilio: ' + error.message);
      });
    } else {
      Video.createLocalTracks().then(tracks => {
        connectOptions.tracks = tracks.concat(dataTrack);
        // Join the Room with the token from the server and the
        // LocalParticipant's Tracks.
        Video.connect(data.token, connectOptions).then(roomJoined, function (error) {
          log('Could not connect to Twilio: ' + error.message);
        });
      });
    }
  };

  // Bind button to leave Room.
  document.getElementById('button-leave').onclick = function() {
    log('Leaving room...');
    activeRoom.disconnect();
  };

  // Bind button to mute.
  document.getElementById('button-mute').onclick = function() {
    activeRoom.localParticipant.audioTracks.forEach(function(audioTrack) {
      if(audioTrack.isTrackEnabled){
        log('Mute audio...');
        audioTrack.track.disable();
      } else {
        log('Unmute audio...');
        audioTrack.track.enable();
      }
    });
  };
});

// Get the Participant's Tracks.
function getTracks(participant) {
  return Array.from(participant.tracks.values()).filter(function(publication) {
    return publication.track;
  }).map(function(publication) {
    return publication.track;
  });
}

// Successfully connected!
function roomJoined(room) {
  window.room = activeRoom = room;

  log("Joined as '" + identity + "'");
  document.getElementById('button-join').style.display = 'none';
  document.getElementById('button-leave').style.display = 'inline';

  // Attach LocalParticipant's Tracks, if not already attached.
  var previewContainer = document.getElementById('local-media');
  if (!previewContainer.querySelector('video')) {
    attachTracks(getTracks(room.localParticipant), previewContainer);
  }

  // Attach the Tracks of the Room's Participants.
  var remoteMediaContainer = document.getElementById('remote-media');
  room.participants.forEach(function(participant) {
    log("Already in Room: '" + participant.identity + "'");
    participantConnected(participant, remoteMediaContainer);
  });

  // When a Participant joins the Room, log the event.
  room.on('participantConnected', function(participant) {
    log("Joining: '" + participant.identity + "'");
    participantConnected(participant, remoteMediaContainer);
  });

  // When a Participant leaves the Room, detach its Tracks.
  room.on('participantDisconnected', function(participant) {
    log("RemoteParticipant '" + participant.identity + "' left the room");
    detachParticipantTracks(participant);
  });

  window.onbeforeunload = leaveRoomIfJoined;

  // Once the LocalParticipant leaves the room, detach the Tracks
  // of all Participants, including that of the LocalParticipant.
  room.on('disconnected', function() {
    log('Left');
    if (previewTracks) {
      previewTracks.forEach(function(track) {
        track.stop();
      });
      previewTracks = null;
    }
    detachParticipantTracks(room.localParticipant);
    room.participants.forEach(detachParticipantTracks);
    activeRoom = null;
    document.getElementById('button-join').style.display = 'inline';
    document.getElementById('button-leave').style.display = 'none';
  });
}

// Preview LocalParticipant's Tracks.
document.getElementById('button-preview').onclick = function() {
  var localTracksPromise = previewTracks
    ? Promise.resolve(previewTracks)
    : Video.createLocalTracks();

  localTracksPromise.then(function(tracks) {
    window.previewTracks = previewTracks = tracks;
    var previewContainer = document.getElementById('local-media');
    if (!previewContainer.querySelector('video')) {
      attachTracks(tracks, previewContainer);
    }
  }, function(error) {
    console.error('Unable to access local media', error);
    log('Unable to access Camera and Microphone');
  });
};

// Activity log.
function log(message) {
  var logDiv = document.getElementById('log');
  logDiv.innerHTML += '<p>&gt;&nbsp;' + message + '</p>';
  logDiv.scrollTop = logDiv.scrollHeight;
}

// Leave Room.
function leaveRoomIfJoined() {
  if (activeRoom) {
    activeRoom.disconnect();
  }
}

/**
 * Draw a circle on the <canvas> element.
 * @param {HTMLCanvasElement} canvas
 * @param {string} color
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function drawCircle(canvas, color, x, y) {
  let rect = canvas.getBoundingClientRect();
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(
    x,
    y,
    10,
    0,
    2 * Math.PI,
    false);
  context.fillStyle = color;
  context.fill();
}
