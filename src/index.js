const { resolve } = require('node:path');
const { run } = require('./app');

function main() {
    try {
        try {
            process.loadEnvFile(resolve(__dirname, '../.env'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        run();
    } catch (error) {
        console.error('CHILL AVVU MAMA · ' + error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = { main };
