const { Redis } = require('@upstash/redis');

const GAME_KEY = 'superbowl-game-state';

// Parse the REDIS_URL manually
// Format: redis://default:password@host:port
function parseRedisUrl(url) {
    const match = url.match(/redis:\/\/([^:]+):([^@]+)@([^:]+):(\d+)/);
    if (match) {
        return {
            url: `https://${match[3]}`,
            token: match[2]
        };
    }
    throw new Error('Invalid REDIS_URL format');
}

const redisConfig = parseRedisUrl(process.env.REDIS_URL);
const redis = new Redis({
    url: redisConfig.url,
    token: redisConfig.token
});

async function getGameState() {
    try {
        const state = await redis.get(GAME_KEY);
        if (!state) {
            const defaultState = {
                squares: Array(100).fill(null),
                rowNumbers: [],
                colNumbers: [],
                numbersAssigned: false,
                team1Name: 'Patriots',
                team2Name: 'Seahawks',
                pricePerSquare: 2,
                quarterScores: [
                    { team1: '', team2: '' },
                    { team1: '', team2: '' },
                    { team1: '', team2: '' },
                    { team1: '', team2: '' }
                ]
            };
            await redis.set(GAME_KEY, defaultState);
            return defaultState;
        }
        return state;
    } catch (error) {
        console.error('Error getting game state:', error);
        throw error;
    }
}

async function saveGameState(state) {
    try {
        await redis.set(GAME_KEY, state);
        return state;
    } catch (error) {
        console.error('Error saving game state:', error);
        throw error;
    }
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const gameState = await getGameState();
            return res.status(200).json(gameState);
        }

        if (req.method === 'POST') {
            const gameState = await getGameState();
            const { action, index, initials, team1Name, team2Name, quarter, team1Score, team2Score, price } = req.body;

            switch (action) {
                case 'claim':
                    if (index < 0 || index > 99) {
                        return res.status(400).json({ error: 'Invalid square index' });
                    }
                    if (!initials || initials.length < 2 || initials.length > 4) {
                        return res.status(400).json({ error: 'Initials must be 2-4 characters' });
                    }
                    if (gameState.squares[index]) {
                        return res.status(400).json({ error: 'Square already claimed' });
                    }
                    gameState.squares[index] = initials.toUpperCase();
                    return res.status(200).json(await saveGameState(gameState));

                case 'assign-numbers':
                    const claimed = gameState.squares.filter(s => s !== null).length;
                    if (claimed < 100) {
                        return res.status(400).json({ error: 'All squares must be claimed first' });
                    }
                    gameState.rowNumbers = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
                    gameState.colNumbers = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
                    gameState.numbersAssigned = true;
                    
                    if (Math.random() < 0.5) {
                        const temp = gameState.team1Name;
                        gameState.team1Name = gameState.team2Name;
                        gameState.team2Name = temp;
                    }
                    
                    return res.status(200).json(await saveGameState(gameState));

                case 'update-teams':
                    if (team1Name) gameState.team1Name = team1Name;
                    if (team2Name) gameState.team2Name = team2Name;
                    return res.status(200).json(await saveGameState(gameState));

                case 'update-price':
                    if (price !== undefined && price >= 0) {
                        gameState.pricePerSquare = price;
                    }
                    return res.status(200).json(await saveGameState(gameState));

                case 'set-score':
                    if (quarter < 0 || quarter > 3) {
                        return res.status(400).json({ error: 'Invalid quarter' });
                    }
                    gameState.quarterScores[quarter] = {
                        team1: team1Score,
                        team2: team2Score
                    };
                    return res.status(200).json(await saveGameState(gameState));

                case 'erase':
                    if (index < 0 || index > 99) {
                        return res.status(400).json({ error: 'Invalid square index' });
                    }
                    gameState.squares[index] = null;
                    return res.status(200).json(await saveGameState(gameState));

                case 'clear-board':
                    gameState.squares = Array(100).fill(null);
                    return res.status(200).json(await saveGameState(gameState));

                case 'reset':
                    const resetState = {
                        squares: Array(100).fill(null),
                        rowNumbers: [],
                        colNumbers: [],
                        numbersAssigned: false,
                        team1Name: gameState.team1Name,
                        team2Name: gameState.team2Name,
                        pricePerSquare: gameState.pricePerSquare || 2,
                        quarterScores: [
                            { team1: '', team2: '' },
                            { team1: '', team2: '' },
                            { team1: '', team2: '' },
                            { team1: '', team2: '' }
                        ]
                    };
                    return res.status(200).json(await saveGameState(resetState));

                default:
                    return res.status(400).json({ error: 'Invalid action' });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ 
            error: 'Server error',
            message: error.message
        });
    }
};
