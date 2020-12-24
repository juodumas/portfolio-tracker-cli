#!/usr/bin/env node
const TickerStreamer = require('./crypto-compare-ticker-streamer')
const columnify = require('columnify')
const coinMappings = require('./coin-mappings')
const debugLib = require("debug")
const debug = require("debug")("portfolio-tracker-cli")
const trace = require("debug")("portfolio-tracker-cli:trace")
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const persistent = require('persistent-json-cache')
const { ArgumentParser } = require('argparse')

let tickerFormat = '{from}{to}{price}{outdated}'
let maxTickerAge = 3600
let outdatedSymbol = '!'
let saveFormats = new Set(['statsjson'])
let targetCurrency = 'USD'


function round(price) {
    if (price > 100) {
        return Math.round(price)
    }
    else if (price > 1) {
        return Math.round(price * 100) / 100
    }

    return Math.round(price * 1000) / 1000
}

function tickerFormatter(original, key) {
    const ticker = this.ticker
    const now = this.now
    const useUSD = this.useUSD
    let price = round(ticker.price)
    let toSymbol = ticker.to
    if (toSymbol == 'USD') {
        toSymbol = '$'
    }
    else if (useUSD) {
        toSymbol = '$'
        price = round(ticker.priceUSD)
    }
    else if (toSymbol == 'BTC') {
        toSymbol = 'µBTC'
        price = round(ticker.price * 1e6)
    }
    switch (key) {
        case 'from': return ticker.from
        case 'to': return toSymbol
        case 'price': return price
        case 'outdated': return (now - ticker.timestamp) > maxTickerAge ? outdatedSymbol : ''
    }
    return original
}

async function loadPortfolios(portfolios) {
    debug("(re)loading portfolios")
    for (let i = 0; i < portfolios.length; i++) {
        const portfolio = portfolios[i]
        const raw = await fsp.readFile(portfolio.src)
        portfolio.data = JSON.parse(raw)
    }
    // TODO subscribe to new coins, unsub from old
}

async function saveStats(tickers, portfolio, coins) {
    const now = new Date().valueOf() / 1000
    const tickersLines = []
    const summary = []
    let totalBalance = 0

    Object.keys(tickers).sort().forEach(id => {
        const ticker = tickers[id]
        const bound = {ticker, now}
        tickersLines.push(tickerFormat.replace(/\{(from|to|price|outdated)\}/g, tickerFormatter.bind(bound)))
        if (ticker.priceUSD) {
            const bound = {ticker, now, useUSD: true}
            tickersLines.push(tickerFormat.replace(/\{(from|to|price|outdated)\}/g, tickerFormatter.bind(bound)))
        }
    })

    Object.keys(coins).sort().forEach(from => {
        const coin = coins[from]
        if (!coin.total && from != 'BTC') {
            return
        }
        totalBalance += coin.total
        summary.push({
            coin: from,
            coin_balance: round(coin.totalOriginal),
            currency: targetCurrency,
            price: round(coin.price),
            balance: round(coin.total),
        })
    })

    summary.sort((a, b) => b.balance - a.balance)

    if (saveFormats.has('balancetxt')) {
        await fsp.writeFile(portfolio.totalPath, '' + round(totalBalance))
    }
    if (saveFormats.has('tickerstxt')) {
        await fsp.writeFile(portfolio.tickersPath, tickersLines.join("\n"))
    }
    if (saveFormats.has('summarytxt')) {
        await fsp.writeFile(portfolio.summaryPath, columnify(summary, {
            config: {
                balance: {align: "right"},
                price: {align: "right"},
            },
        }))
    }
    if (saveFormats.has('statsjson')) {
        await fsp.writeFile(portfolio.allStatsPath, JSON.stringify({
            currency: targetCurrency,
            balance: totalBalance,
            tickers: tickersLines,
            summary: summary
        }, null, 4))
    }
}

function getPortfolioStats(tickers, portfolio) {
    const now = new Date().valueOf() / 1000
    const coins = {}
    const missingCoinTickers = []

    for (let coin in portfolio.data) {
        let totalCoin = 0
        let totalUSD = 0
        let priceUSD = 0
        const wallets = portfolio.data[coin].wallets
        wallets.forEach(wallet => {
            if (!wallet.total) {
                return
            }

            totalCoin += wallet.total
        })

        let ticker
        if (tickers[`${coin}-USD`]) {
            ticker = tickers[`${coin}-USD`]
            priceUSD = ticker.price
            totalUSD = totalCoin * priceUSD
        }
        else {
            ticker = tickers[`${coin}-BTC`] || tickers[`${coin}-ETH`]
            if (ticker && ticker.priceUSD) {
                priceUSD = ticker.priceUSD
                totalUSD = totalCoin * priceUSD
            }
            else {
                missingCoinTickers.push(coin)
                continue
            }
        }

        coins[coin] = {
            from: coin,
            to: 'USD',
            price: priceUSD,
            total: totalUSD,
            totalOriginal: totalCoin,
            outdated: (now - ticker.timestamp) > maxTickerAge
        }
    }

    if (missingCoinTickers.length) {
        missingCoinTickers.sort()
        debug(`missing tickers for:`, missingCoinTickers.join(", "))
    }

    return coins
}

async function savePortfoliosStats(tickers, portfolios) {
    portfolios.forEach(async portfolio => {
        const coins = getPortfolioStats(tickers, portfolio)
        await saveStats(tickers, portfolio, coins)
    })
}

function getTickerSubscriptions(portfolios) {
    const tickers = new Set()
    portfolios.forEach(portfolio => {
        const portfolioData = portfolio.data
        for (let from in portfolioData) {
            if (coinMappings[from]) {
                coinMappings[from].to.forEach(to => {
                    tickers.add(`${from}-${to}`)
                })
            }
            else {
                tickers.add(from + '-BTC')
            }
        }
    })

    return Array.from(tickers)
}

async function main() {
    const saveChoices = ['statsjson', 'balancetxt', 'tickerstxt', 'summarytxt']
    const portfolioReloadInterval = 600 * 1000
    const statsSaveInterval = 1000

    const parser = new ArgumentParser()
    let apiKey

    parser.add_argument('-k', '--api-key', {help: 'Path to a JSON file containing the CryptoCompare API key in a "cryptocompare" property. Alternatively supply the API key directly in a CRYPTOCOMPARE_API_KEY environment variable.'})
    parser.add_argument('-p', '--portfolio', {action: 'append', required: true, help: 'Path to a JSON file containing the portfolio to track. Can be specified multiple times for multiple portfolios.'})
    parser.add_argument('-d', '--destination', {action: 'append', required: true, help: 'Path to the destination directory where portfolio stats will be saved. Can be specified multiple times for multiple portfolios.'})
    parser.add_argument('--save', {action: 'append', default: Array.from(saveFormats), choices: saveChoices, help: 'Which stats files should be saved. Can be specified multiple times (default: %(default)s).'})
    parser.add_argument('--ticker-format', {default: tickerFormat, help: 'Format used for ticker output. Available fields: {from}, {to}, {price}, {outdated} (default: %(default)s).'})
    parser.add_argument('-q', '--quiet', {help: 'Print errors only.'})
    parser.add_argument('-v', '--verbose', {action: 'store_true', help: 'Print more info.'})

    const args = parser.parse_args()

    if (!args.quiet) {
        const debugNS = ['portfolio-tracker-cli,portfolio-tracker-cli:*']
        if (!args.verbose) {
            debugNS.push('-portfolio-tracker-cli:trace')
            debugNS.push('-portfolio-tracker-cli:*:trace')
        }
        debugLib.enable(debugNS.join(','))
    }

    if (args.api_key) {
        apiKey = JSON.parse(await fsp.readFile(args.api_key)).cryptocompare
    }
    else if (process.env.CRYPTOCOMPARE_API_KEY) {
        apiKey = process.env.CRYPTOCOMPARE_API_KEY
    }
    else {
        parser.error('API key is required: provide -k/--api-key argument or CRYPTOCOMPARE_API_KEY environment variable')
    }

    tickerFormat = args.ticker_format
    saveFormats = new Set(args.save)

    const portfolios = []

    const portfolioFiles = args.portfolio
    const statsDirectories = args.destination
    for (let i = 0; i < portfolioFiles.length; i++) {
        if (!statsDirectories[i]) {
            statsDirectories[i] = statsDirectories[i - 1]
        }
    }

    // Init portfolios..
    portfolioFiles.forEach((portfolioFile, idx) => {
        const statsDir = statsDirectories[idx]

        if (!fs.existsSync(portfolioFile)) {
            console.error('Error: given portfolio file does not exist:', portfolioFile)
            process.exit(1)
        }
        if (!fs.existsSync(statsDir)) {
            console.error('Error: given stats directory does not exist:', statsDirectories)
            process.exit(1)
        }

        const portfolio = {
            key: path.basename(portfolioFile, '.json'),
            src: portfolioFile,
            statsDir: statsDir,
            data: {}
        }
        const key = portfolio.key

        portfolio.tickersPath = path.join(statsDir, `${key}.tickers.txt`)
        portfolio.summaryPath = path.join(statsDir, `${key}.summary.txt`)
        portfolio.totalPath = path.join(statsDir, `${key}.balance.txt`)
        portfolio.allStatsPath = path.join(statsDir, `${key}.stats.json`)

        portfolios.push(portfolio)

    })

    await loadPortfolios(portfolios)

    let state
    const scriptDir = path.dirname(await fsp.realpath(process.argv[1]))
    const cachePath = path.join(scriptDir, 'node_modules', '.cache', path.basename(scriptDir))
    try {
        await fsp.mkdir(cachePath, {recursive: true})
        await fsp.access(cachePath, fs.constants.R_OK | fs.constants.W_OK)
        state = await persistent(path.join(cachePath, 'state.json'))
        trace('using cache directory:', cachePath)
    } catch (e) {
        state = {}
        debug('cannot use cache directory, skipping:', cachePath, e)
    }

    const subs = getTickerSubscriptions(portfolios)

    if (!state.tickers) {
        state.tickers = {}
    }

    const reloadFun = () => loadPortfolios(portfolios)
    const reloadTimer = setInterval(reloadFun, portfolioReloadInterval)

    const saveFun = () => savePortfoliosStats(state.tickers, portfolios)
    const saveTimer = setInterval(saveFun, statsSaveInterval)

    const tickerStreamer = new TickerStreamer(apiKey)

    async function cleanup(err) {
        try {
            if (err) {
                console.error("Error caught: cleaning up...")
                console.error(err)
            }
            else {
                debug("Exit cleanup...")
            }
            await tickerStreamer.disconnect()
            clearInterval(reloadTimer)
            clearInterval(saveTimer)
            process.exit(err ? 1 : 0)
        }
        catch (e) {
            console.error("Error in error handler:", e)
            process.exit(1)
        }
    }

    process.on('SIGHUP', reloadFun)
    process.on('SIGINT', async () => await cleanup())
    process.on('SIGTERM', async () => await cleanup())
    process.on('uncaughtException', cleanup)
    process.on('unhandledRejection', cleanup)

    await tickerStreamer.connect()
    tickerStreamer.subscribe(subs)

    tickerStreamer.on('ticker:update', (from, to, price, ticker) => {
        state.tickers[`${from}-${to}`] = ticker
        if (to == 'BTC' && state.tickers['BTC-USD']) {
            ticker.priceUSD = state.tickers['BTC-USD'].price * price
        }
        else if (to == 'ETH' && state.tickers['ETH-USD']) {
            ticker.priceUSD = state.tickers['ETH-USD'].price * price
        }
    })
}

main()
