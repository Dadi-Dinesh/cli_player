const { spawn } = require("child_process");

const vlcPath = "/Applications/VLC.app/Contents/MacOS/VLC";

const song = "songs/00 - Ab Yevaro Nee Baby - Naa-Songs.com.mp3";

const player = spawn(vlcPath, [
    "--intf", "dummy",
    song
]);

console.log("VLC started");
console.log("Playing:", song);

player.on("error", (error) => {
    console.log("VLC error:", error.message);
});

player.on("close", (code) => {
    console.log("VLC closed:", code);
});