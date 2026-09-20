const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const VLC_PATH = "/Applications/VLC.app/Contents/MacOS/VLC";
let SONGS_DIR = "./songs";

let songs = [];
let userSelectionIndex = 0;
let currentlyPlaying = null;
let currentProcess = null;

let isPaused = true;
let volume = 100;
// LIST SONGS
function listSongs() {

    console.clear();

    console.log("=================================");
    console.log("CHILL AVVU MAMA");
    console.log("=================================\n");

    songs.forEach((song, index) => {

        const prefix =
            index === userSelectionIndex ? "> " : "  ";

        console.log(`${prefix}${index + 1}. ${song}`);
    });

    console.log("\n---------------------------------");
    console.log("↑ ↓  : Select song");
    console.log("ENTER: Play selected song");
    console.log("SPACE/P: Play / Pause");
    console.log("←    : Previous song");
    console.log("→    : Next song");
    console.log("+    : Volume Up");
    console.log("-    : Volume Down");
    console.log("Q    : Quit");
    console.log("---------------------------------\n");

    if (!currentlyPlaying) {

        console.log("Status: Not Playing");

    } else if (isPaused) {

        console.log(`Status: Playing - ${currentlyPlaying}`);

    } else {

        console.log(`Status: Paused - ${currentlyPlaying}`);
    }

    console.log(`Volume: ${volume}%`);
}
// PLAY SONG
function playSong(songFilePath) {

    if (currentProcess) {
        currentProcess.kill();
    }

    currentProcess = spawn(
        VLC_PATH,
        [
            "--intf",
            "rc",
            "--play-and-exit",
            songFilePath
        ],
        {
            stdio: "pipe"
        }
    );

    // Set VLC volume when song starts
    setTimeout(() => {
        if (currentProcess && currentProcess.stdin) {
            currentProcess.stdin.write("volume 256\n");
        }
    }, 500);

    currentProcess.on("error", (error) => {
        console.log("VLC Error:", error.message);
    });
}
// PLAY / PAUSE
function togglePlayPause() {
    if (!currentlyPlaying || !currentProcess) {
        currentlyPlaying = songs[userSelectionIndex];
        playSong(
            SONGS_DIR + "/" + songs[userSelectionIndex]
        );
        return;
    }
    currentProcess.stdin.write("pause\n");
    isPaused = !isPaused;
    listSongs();
}
// NEXT SONG
function nextSong() {

    if (songs.length === 0) {
        return;
    }

    userSelectionIndex =
        (userSelectionIndex + 1) % songs.length;

    currentlyPlaying =
        songs[userSelectionIndex];

    playSong(
        SONGS_DIR + "/" + songs[userSelectionIndex]
    );

    listSongs();
}
// PREVIOUS SONG
function previousSong() {
    if (songs.length === 0) {
        return;
    }
    userSelectionIndex =
        (userSelectionIndex - 1 + songs.length)
        % songs.length;
    currentlyPlaying =
        songs[userSelectionIndex];
    playSong(
        SONGS_DIR + "/" + songs[userSelectionIndex]
    );

    listSongs();
}
// VOLUME UP
function volumeUp() {

    if (!currentProcess) {
        return;
    }

    volume += 10;

    if (volume > 200) {
        volume = 200;
    }

    currentProcess.stdin.write(
        `volume ${volume}\n`
    );

    console.log(`Volume: ${volume}%`);
}
// VOLUME DOWN
function volumeDown() {
    if (!currentProcess) {
        return;
    }
    volume -= 10;

    if (volume < 0) {
        volume = 0;
    }
    currentProcess.stdin.write(
        `volume ${volume}\n`
    );
    console.log(`Volume: ${volume}%`);
}
// QUIT
function quitPlayer() {

    console.log("\nExiting player...");

    if (currentProcess) {

        currentProcess.removeAllListeners("exit");
        currentProcess.stdin.write("stop\n");

        setTimeout(() => {

            if (currentProcess) {
                currentProcess.kill();
            }

            process.exit(0);

        }, 300);

    } else {

        process.exit(0);
    }
}
// ASK SONG DIRECTORY
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.question(
    "Enter songs path (default ./songs): ",
    (answer) => {

        if (answer.trim()) {
            SONGS_DIR = answer.trim();
        }

        rl.close();
        // READ SONGS
        songs = fs
            .readdirSync(SONGS_DIR)
            .filter(
                (file) =>
                    file.endsWith(".mp3") ||
                    file.endsWith(".aiff")
            );


        if (songs.length === 0) {

            console.log("No songs found.");

            process.exit(0);
        }
        listSongs();
        // KEYBOARD INPUT
        process.stdin.setRawMode(true);

        process.stdin.resume();

        process.stdin.setEncoding("utf8");


        process.stdin.on("data", (rawUserInput) => {

            const key = rawUserInput;
            // Q = QUIT
            if (key === "q" || key === "Q") {

                quitPlayer();

                return;
            }
            // SPACE / P = PLAY PAUSE
            if (
                key === " " ||
                key === "p" ||
                key === "P"
            ) {
                togglePlayPause();

                return;
            }
            // ENTER = PLAY SELECTED SONG
            if (key === "\r") {
                currentlyPlaying =
                    songs[userSelectionIndex];

                playSong(
                    SONGS_DIR +
                    "/" +
                    songs[userSelectionIndex]
                );

                listSongs();

                return;
            }
            // + = VOLUME UP
            if (key === "+" || key === "=") {

                volumeUp();

                return;
            }
            // - = VOLUME DOWN
            if (key === "-") {

                volumeDown();

                return;
            }
            // ARROW KEYS
            if (
                key.length >= 3 &&
                key[0] === "\x1b" &&
                key[1] === "["
            ) {
                // UP
                if (key[2] === "A") {

                    userSelectionIndex =
                        (userSelectionIndex - 1 + songs.length)
                        % songs.length;

                    listSongs();
                }
                // DOWN
                else if (key[2] === "B") {

                    userSelectionIndex =
                        (userSelectionIndex + 1)
                        % songs.length;

                    listSongs();
                }
                // LEFT = PREVIOUS
                else if (key[2] === "D") {

                    previousSong();
                }
                // RIGHT = NEXT
                else if (key[2] === "C") {

                    nextSong();
}}});});