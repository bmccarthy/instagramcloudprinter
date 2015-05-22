(function () {
    'use strict';

    /***
     * This app uses dotenv (Todo: add link). You should add a .env file to the root folder with the below process.env variables defined.
     *
     */

    var winston = require('winston');
    var Papertrail = require('winston-papertrail').Papertrail;

    var logger = new winston.Logger({
        transports: [
            new winston.transports.Papertrail({
                host: process.env.PAPER_TRAIL_HOST, // host used for logging to paper trail
                port: process.env.PAPER_TRAIL_PORT // port used for logging to paper trail
            })
        ]
    });

    module.exports = {
        port: process.env.PORT || 8000,
        host: process.env.HOST,
        printFolder: __dirname + '/pictures/', // directory to place the pictures while they are being printed.
        instagram: {
            client: process.env.INSTAGRAM_CLIENT,
            secret: process.env.INSTAGRAM_SECRET,
            verify: process.env.INSTAGRAM_VERIFY
        },
        google: {
            client: process.env.GOOGLE_CLIENT,
            secret: process.env.GOOGLE_SECRET,
            redirect: process.env.GOOGLE_REDIRECT
        },
        printTag: 'instagramprintjob', // tag to use on google cloud print to identify jobs printed with this application
        database: {
            host: 'localhost', // host for the rethinkdb connection
            port: 28015,
            db: 'instagramcloudprinter' // db name for the application
        },
        logger: logger,
        TOKEN_SECRET: process.env.TOKEN_SECRET
    };

})();
