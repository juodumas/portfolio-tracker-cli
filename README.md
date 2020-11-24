# portfolio-tracker-cli

CLI utility to track your cryptocurrency portfolio in real-time using
CryptoCompare streamer (websocket) API. Saves ticker prices &amp; balances to
text files.

My goal when creating this software was to track balances of a few crypto
experiments and get crypto tickers in [i3-wm](https://i3wm.org/) status bar.

Note: you have to register for a free cryptocompare.com API key to use this:
https://www.cryptocompare.com/cryptopian/api-keys


## Example usage

Below commands are run [from this examples/ directory](https://github.com/juodumas/portfolio-tracker-cli/tree/main/example).

```shell

$ npm install -g portfolio-tracker-cli

$ cat portfolio1.json
{
    "BTC": {
        "wallets": [ { "total": 1 } ]
    },
    "ETH": {
        "wallets": [ { "total": 10 } ]
    },
    "DOGE": {
        "wallets": [ { "total": 1000 } ]
    }
}

$ portfolio-tracker-cli -k api-key.json -p portfolio1.json -d portfolio-stats/
  portfolio-tracker-cli (re)loading portfolios +0ms
  portfolio-tracker-cli:ccapi connecting... +0ms
  portfolio-tracker-cli:ccapi connection established +6s

# Portfolio tracker stays connected to cryptocompare api and periodically writes data to file.
# Press ctrl-c or send SIGTERM to close.
# Let's check those periodically updated stats:

$ cat portfolio-stats/portfolio1.stats.json
{
    "currency": "USD",
    "balance": 25466.60129,
    "tickers": [
        "BTC$19378",
        "DOGE$0.004",
        "ETH$608"
    ],
    "summary": [
        {
            "coin": "BTC",
            "coin_balance": 1,
            "currency": "USD",
            "price": 19378,
            "balance": 19378
        },
        {
            "coin": "DOGE",
            "coin_balance": 1000,
            "currency": "USD",
            "price": 0.004,
            "balance": 3.87
        },
        {
            "coin": "ETH",
            "coin_balance": 10,
            "currency": "USD",
            "price": 608,
            "balance": 6085
        }
    ]
}
```

```shell
# Now we use an environment variable instead of the api-key.json file and save
# plain text stats instead of JSON.

$ export CRYPTOCOMPARE_API_KEY=<your-api-key>
$ portfolio-tracker-cli -p portfolio1.json -d portfolio-stats/ --save balancetxt --save tickerstxt --save summarytxt
  portfolio-tracker-cli (re)loading portfolios +0ms
  portfolio-tracker-cli:ccapi connecting... +0ms
  portfolio-tracker-cli:ccapi connection established +6s

$ cat portfolio-stats/portfolio1.balance.txt 
25532

$ cat portfolio-stats/portfolio1.tickers.txt 
BTC$19404
DOGE$0.004
ETH$612

$ cat portfolio-stats/portfolio1.summary.txt 
COIN COIN_BALANCE CURRENCY PRICE BALANCE
BTC  1            USD      19404   19404
DOGE 1000         USD      0.004    4.07
ETH  10           USD        612    6124

# Check help output for more options:
$ portfolio-tracker-cli --help
```
