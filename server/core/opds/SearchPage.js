const BasePage = require('./BasePage');

class SearchPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'search';
        this.title = 'Поиск';
    }

    async body(req) {
        const result = {};

        const query = {
            type: req.query.type || '',
            term: req.query.term || '',
            page: parseInt(req.query.page, 10) || 1,
        };

        let entry = [];
        if (query.type) {
            if (['author', 'series', 'title'].includes(query.type)) {
                const from = query.type;
                const page = query.page;

                const limit = 100;
                const offset = (page - 1)*limit;
                const queryRes = await this.webWorker.search(from, {[from]: query.term, del: 0, offset, limit});

                const found = queryRes.found;

                for (let i = 0; i < found.length; i++) {
                    if (i >= limit)
                        break;

                    const row = found[i];

                    entry.push(
                        this.makeEntry({
                            id: row.id,
                            title: row[from],
                            link: this.navLink({href: `/${from}?${from}==${encodeURIComponent(row[from])}`}),
                        }),
                    );
                }

                if (queryRes.totalFound > offset + found.length) {
                    entry.push(
                        this.makeEntry({
                            id: 'next_page',
                            title: '[Следующая страница]',
                            link: this.navLink({href: `/${this.id}?type=${from}&term=${encodeURIComponent(query.term)}&page=${page + 1}`}),
                        }),
                    );
                }
            }
        } else {
            //корневой раздел
            entry = [
                this.makeEntry({
                    id: 'search_author',
                    title: 'Поиск авторов',
                    link: this.navLink({href: `/${this.id}?type=author&term=${encodeURIComponent(query.term)}`}),
                }),
                this.makeEntry({
                    id: 'search_series',
                    title: 'Поиск серий',
                    link: this.navLink({href: `/${this.id}?type=series&term=${encodeURIComponent(query.term)}`}),
                }),
                this.makeEntry({
                    id: 'search_title',
                    title: 'Поиск книг',
                    link: this.navLink({href: `/${this.id}?type=title&term=${encodeURIComponent(query.term)}`}),
                }),
            ]
        }

        result.entry = entry;
        return this.makeBody(result, req);
    }
}

module.exports = SearchPage;