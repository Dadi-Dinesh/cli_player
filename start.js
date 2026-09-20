const { spawn } = require("child_process");

console.clear();

console.log("=================================");
console.log("CHILL AVVU MAMA");
console.log("=================================\n");

console.log("             ▶ START\n");

console.log("        Press ENTER to START");

console.log("\n=================================");

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

process.stdin.on("data", (key) => {

    if (key === "\r") {

        process.stdin.setRawMode(false);
        process.stdin.pause();

        spawn(
            "node",
            ["src/index.js"],
            {
                stdio: "inherit"
            }
        );
    }
});