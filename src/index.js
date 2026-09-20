const { spawn } = require("child_process");
const fs = require("fs");

let SONGS_DIR = "./songs";
let songs = fs
    .readdirSync(SONGS_DIR)
    .filter(
        (file) =>
            file.endsWith(".mp3") ||
            file.endsWith(".aiff")
    );

let userSelectionIndex = 0;
let currentProcess = null;
const VLC_PATH = "/Applications/VLC.app/Contents/MacOS/VLC";
function listSongs() {
    console.clear();
    console.log("=================================");
    console.log("          Chill Mama");
    console.log("=================================\n");
    songs.forEach((song, index) => {
        const prefix =
            index === userSelectionIndex ? "> " : "  ";
        console.log(`${prefix}${index + 1}. ${song}`);
    });
    console.log("\n↑ ↓ : Select Song");
    console.log("ENTER: Play Song");
    console.log("Q    : Quit");
}
// Play selected song
function playSong(songFilePath) {
    // Stop previous song
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

    // Handle VLC error
    currentProcess.on("error", (error) => {
        console.log("VLC Error:", error.message);
    });
}

// Show songs initially
listSongs();

// Enable keyboard input
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

// Keyboard controls
process.stdin.on("data", (key) => {

    // =========================
    // QUIT
    // =========================

    if (key === "q" || key === "Q") {

        if (currentProcess) {
            currentProcess.kill();
        }

        process.exit(0);
    }

    // =========================
    // ENTER - PLAY SONG
    // =========================

    if (key === "\r") {

        const selectedSong =
            SONGS_DIR +
            "/" +
            songs[userSelectionIndex];

        playSong(selectedSong);

        return;
    }

    // =========================
    // ARROW KEYS
    // =========================

    if (
        key.length >= 3 &&
        key[0] === "\x1b" &&
        key[1] === "["
    ) {

        // UP ARROW
        if (key[2] === "A") {

            userSelectionIndex =
                (userSelectionIndex - 1 + songs.length)
                % songs.length;

            listSongs();
        }

        // DOWN ARROW
        else if (key[2] === "B") {

            userSelectionIndex =
                (userSelectionIndex + 1)
                % songs.length;

            listSongs();
        }
    }
});