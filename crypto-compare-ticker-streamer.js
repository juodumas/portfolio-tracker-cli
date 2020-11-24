const EventEmitter = require("events")
const WebSocket = require('ws')
const debug = require("debug")("portfolio-tracker-cli:ccapi")
const trace = require("debug")("protfolio-tracker-cli:ccapi:trace")

module.exports = class TickerStreamer extends EventEmitter {
    constructor(apiKey) {
        super()

        this.url = `wss://streamer.cryptocompare.com/v2?api_key=${apiKey}`
        this.subs = new Set()
        this.pendingSubs = new Set()
    }

    async connect() {
        let pingIntervalHandle

        const _connect = (resolve, reject) => {
            debug(`connecting...`)
            clearInterval(pingIntervalHandle)

            const ws = new WebSocket(this.url)

            this._ws = ws
            this._connected = false

            let pingsSent = 0
            let pongsReceived = 0

            const maxPingsLost = 3
            const pingInterval = 30 * 1000

            pingIntervalHandle = setInterval(async () => {
                if (pingsSent == maxPingsLost) {
                    if (pongsReceived == 0) {
                        console.error(`Error: lost three ping replies, reconnecting.`)
                        await this._ws.close()
                        _connect(resolve, reject)
                        return
                    }
                    pingsSent = 0
                    pongsReceived = 0
                }
                try {
                    ws.ping()
                }
                catch (e) {
                    console.error(`Error sending ping (${e}), reconnecting.`)
                    await this._ws.close()
                    _connect(resolve, reject)
                }
                pingsSent++
            }, pingInterval)

            ws.on('open', () => {
                debug('connection established')
                this._connected = true
                if (this.subs.size) {
                    trace("subscribing to previous subs: %s", this.subs)
                    this.subs.forEach(sub => {
                        this.subscribe(sub)
                    })
                }
                resolve()
            })

            ws.on('error', err => {
                console.error('error:', err)
            })

            ws.on('pong', () => {
                trace('ping reply received')
                pongsReceived++
            })

            ws.on('message', data => {
                try {
                    data = JSON.parse(data)
                }
                catch (e) {
                    console.error('Error parsing JSON data:', e)
                    return
                }

                switch (data.MESSAGE || data.TYPE) {
                    case 'LOADCOMPLETE':
                    case 'SUBSCRIBECOMPLETE':
                    case 'STREAMERWELCOME':
                        trace(data)
                        break
                    case '5': {
                        const ticker = {
                            flags: data.FLAGS,
                            from: data.FROMSYMBOL,
                            to: data.TOSYMBOL,
                            price: data.PRICE,
                            vol24h_from: data.VOLUME24HOUR,
                            vol24h_to: data.VOLUME24HOURTO,
                            vol24h_top_from: data.TOPTIERVOLUME24HOUR,
                            vol24h_top_to: data.TOPTIERVOLUME24HOURTO,
                            timestamp: data.LASTUPDATE,
                            lastmarket: data.MARKET
                        }
                        if (ticker.price && ticker.timestamp) {
                            trace(`ticker:update ${ticker.from}-${ticker.to}: ${ticker.price} ${new Date(ticker.timestamp * 1000).toISOString()} ${ticker.lastmarket}`)
                            this.emit("ticker:update", ticker.from, ticker.to, ticker.price, ticker)
                        }
                        break
                    }
                    case 'ERROR':
                        console.error("cryptocompare error:", data)
                        break
                    case 'HEARTBEAT':
                        break
                    default:
                        console.error("UNKNOWN MESSAGE", data)
                }
            })
        }

        return new Promise((resolve, reject) => {
            _connect(resolve, reject)
        })
    }

    async disconnect() {
        await this._ws.close()
        debug('disconnect')
    }

    async subscribe(subs) {
        trace('subscribing to', subs)
        this.subs.add(subs)
        if (!Array.isArray(subs)) {
            subs = [subs]
        }
        this._ws.send(JSON.stringify({
            "action": "SubAdd",
            "subs": subs.map(sub => `5~CCCAGG~${sub.replace('-', '~')}`),
        }))
    }

    async unsubscribe(subs) {
        trace('unsubscribing from', subs)
        this.subs.delete(subs)
        if (!Array.isArray(subs)) {
            subs = [subs]
        }
        this._ws.send(JSON.stringify({
            "action": "SubRemove",
            "subs": subs.map(sub => `5~CCCAGG~${sub.replace('-', '~')}`),
        }))
    }
}
