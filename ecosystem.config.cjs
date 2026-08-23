/**
 * PM2 ecosystem - production process manager for the API.
 *
 * Install:  npm i -g pm2
 * Start:    pm2 start ecosystem.config.cjs --env production
 * Reload:   pm2 reload api          (zero-downtime)
 * Monitor:  pm2 monit
 * Logs:     pm2 logs api
 */
module.exports = {
    apps: [
        {
            name: 'api',
            script: './index.js',
            instances: 'max',              // one worker per CPU core
            exec_mode: 'cluster',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',    // recycle leaking workers
            env_production: {
                NODE_ENV: 'production',
                PORT: 5000
            },
            out_file: './logs/out.log',
            error_file: './logs/error.log',
            merge_logs: true,
            time: true
        }
    ]
};
