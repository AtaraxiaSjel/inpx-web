const RootPage = require('./RootPage');
const AuthorPage = require('./AuthorPage');

module.exports = function(app, config) {
    const opdsRoot = '/opds';
    config.opdsRoot = opdsRoot;

    const root = new RootPage(config);
    const author = new AuthorPage(config);

    const routes = [
        ['', root],
        ['/root', root],
        ['/author', author],
    ];

    const pages = new Map();
    for (const r of routes) {
        pages.set(`${opdsRoot}${r[0]}`, r[1]);
    }

    const opds = async(req, res, next) => {
        try {
            const page = pages.get(req.path);

            if (page) {
                res.set('Content-Type', 'application/atom+xml; charset=utf-8');

                const result = await page.body(req, res);

                if (result !== false)
                    res.send(result);
            } else {
                next();
            }
        } catch (e) {
            res.status(500).send({error: e.message});
        }
    };

    app.get([opdsRoot, `${opdsRoot}/*`], opds);
};

