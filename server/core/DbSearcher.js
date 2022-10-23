//const _ = require('lodash');
const HeavyCalc = require('./HeavyCalc');
const utils = require('./utils');

const maxMemCacheSize = 100;

const maxUtf8Char = String.fromCodePoint(0xFFFFF);
const ruAlphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const enAlphabet = 'abcdefghijklmnopqrstuvwxyz';
const enruArr = (ruAlphabet + enAlphabet).split('');

class DbSearcher {
    constructor(config, db) {
        this.config = config;
        this.db = db;

        this.searchFlag = 0;
        this.timer = null;
        this.closed = false;

        this.heavyCalc = new HeavyCalc({threads: 4});

        this.searchCache = {
            memCache: new Map(),
            authorIdsAll: false,
        };

        this.periodicCleanCache();//no await
    }

    getWhere(a) {
        const db = this.db;

        a = a.toLowerCase();
        let where;

        //особая обработка префиксов
        if (a[0] == '=') {
            a = a.substring(1);
            where = `@dirtyIndexLR('value', ${db.esc(a)}, ${db.esc(a)})`;
        } else if (a[0] == '*') {
            a = a.substring(1);
            where = `@indexIter('value', (v) => (v.indexOf(${db.esc(a)}) >= 0) )`;
        } else if (a[0] == '#') {
            a = a.substring(1);
            where = `@indexIter('value', (v) => {
                const enru = new Set(${db.esc(enruArr)});
                return !v || (!enru.has(v[0].toLowerCase()) && v.indexOf(${db.esc(a)}) >= 0);
            })`;
        } else {
            where = `@dirtyIndexLR('value', ${db.esc(a)}, ${db.esc(a + maxUtf8Char)})`;
        }

        return where;
    }

    async selectAuthorIds(query) {
        const db = this.db;

        let authorIds = [];

        //сначала выберем все id авторов по фильтру
        //порядок id соответсвует ASC-сортировке по author
        if (query.author && query.author !== '*') {
            const where = this.getWhere(query.author);

            const authorRows = await db.select({
                table: 'author',
                rawResult: true,
                where: `return Array.from(${where})`,
            });

            authorIds = authorRows[0].rawResult;
        } else {//все авторы
            if (!this.searchCache.authorIdsAll) {
                const authorRows = await db.select({
                    table: 'author',
                    rawResult: true,
                    where: `return Array.from(@all())`,
                });

                authorIds = authorRows[0].rawResult;

                this.searchCache.authorIdsAll = authorIds;
            } else {//оптимизация
                authorIds = this.searchCache.authorIdsAll;
            }
        }

        const idsArr = [];

        //серии
        if (query.series && query.series !== '*') {
            const where = this.getWhere(query.series);

            const seriesRows = await db.select({
                table: 'series',
                rawResult: true,
                where: `
                    const ids = ${where};

                    const result = new Set();
                    for (const id of ids) {
                        const row = @unsafeRow(id);
                        for (const authorId of row.authorId)
                            result.add(authorId);
                    }

                    return Array.from(result);
                `
            });

            idsArr.push(seriesRows[0].rawResult);
        }

        //названия
        if (query.title && query.title !== '*') {
            const where = this.getWhere(query.title);

            let titleRows = await db.select({
                table: 'title',
                rawResult: true,
                where: `
                    const ids = ${where};

                    const result = new Set();
                    for (const id of ids) {
                        const row = @unsafeRow(id);
                        for (const authorId of row.authorId)
                            result.add(authorId);
                    }

                    return Array.from(result);
                `
            });

            idsArr.push(titleRows[0].rawResult);

            //чистки памяти при тяжелых запросах
            if (this.config.lowMemoryMode && query.title[0] == '*') {
                titleRows = null;
                utils.freeMemory();
                await db.freeMemory();
            }
        }

        //жанры
        if (query.genre) {
            const genreRows = await db.select({
                table: 'genre',
                rawResult: true,
                where: `
                    const genres = ${db.esc(query.genre.split(','))};

                    const ids = new Set();
                    for (const g of genres) {
                        for (const id of @indexLR('value', g, g))
                            ids.add(id);
                    }
                    
                    const result = new Set();
                    for (const id of ids) {
                        const row = @unsafeRow(id);
                        for (const authorId of row.authorId)
                            result.add(authorId);
                    }

                    return Array.from(result);
                `
            });

            idsArr.push(genreRows[0].rawResult);
        }

        //языки
        if (query.lang) {
            const langRows = await db.select({
                table: 'lang',
                rawResult: true,
                where: `
                    const langs = ${db.esc(query.lang.split(','))};

                    const ids = new Set();
                    for (const l of langs) {
                        for (const id of @indexLR('value', l, l))
                            ids.add(id);
                    }
                    
                    const result = new Set();
                    for (const id of ids) {
                        const row = @unsafeRow(id);
                        for (const authorId of row.authorId)
                            result.add(authorId);
                    }

                    return Array.from(result);
                `
            });

            idsArr.push(langRows[0].rawResult);
        }

/*
        //ищем пересечение множеств
        idsArr.push(authorIds);

        if (idsArr.length > 1) {
            const idsSetArr = idsArr.map(ids => new Set(ids));
            authorIds = Array.from(utils.intersectSet(idsSetArr));
        }

        //сортировка
        authorIds.sort((a, b) => a - b);
*/
        //ищем пересечение множеств в отдельном потоке
        idsArr.push(authorIds);
        authorIds = await this.heavyCalc.run({
            args: idsArr,
            fn: (args) => {
                //из utils.intersectSet
                const intersectSet = (arrSet) => {
                    if (!arrSet.length)
                        return new Set();

                    let min = 0;
                    let size = arrSet[0].size;
                    for (let i = 1; i < arrSet.length; i++) {
                        if (arrSet[i].size < size) {
                            min = i;
                            size = arrSet[i].size;
                        }
                    }

                    const result = new Set();
                    for (const elem of arrSet[min]) {
                        let inAll = true;
                        for (let i = 0; i < arrSet.length; i++) {
                            if (i === min)
                                continue;
                            if (!arrSet[i].has(elem)) {
                                inAll = false;
                                break;
                            }
                        }

                        if (inAll)
                            result.add(elem);
                    }

                    return result;
                };

                //считаем пересечение, если надо
                let result = [];

                if (args.length > 1) {
                    const arrSet = args.map(ids => new Set(ids));
                    result = Array.from(intersectSet(arrSet));
                } else if (args.length == 1) {
                    result = args[0];
                }

                //сортировка
                result.sort((a, b) => a - b);

                return result;
            }
        });

        return authorIds;
    }

    queryKey(q) {
        return JSON.stringify([q.author, q.series, q.title, q.genre, q.lang]);
    }

    async getCached(key) {
        if (!this.config.queryCacheEnabled)
            return null;

        let result = null;

        const db = this.db;
        const memCache = this.searchCache.memCache;

        if (memCache.has(key)) {//есть в недавних
            result = memCache.get(key);

            //изменим порядок ключей, для последующей правильной чистки старых
            memCache.delete(key);
            memCache.set(key, result);
        } else {//смотрим в таблице
            const rows = await db.select({table: 'query_cache', where: `@@id(${db.esc(key)})`});

            if (rows.length) {//нашли в кеше
                await db.insert({
                    table: 'query_time',
                    replace: true,
                    rows: [{id: key, time: Date.now()}],
                });

                result = rows[0].value;
                memCache.set(key, result);

                if (memCache.size > maxMemCacheSize) {
                    //удаляем самый старый ключ-значение
                    for (const k of memCache.keys()) {
                        memCache.delete(k);
                        break;
                    }
                }
            }
        }

        return result;
    }

    async putCached(key, value) {
        if (!this.config.queryCacheEnabled)
            return;

        const db = this.db;

        const memCache = this.searchCache.memCache;
        memCache.set(key, value);

        if (memCache.size > maxMemCacheSize) {
            //удаляем самый старый ключ-значение
            for (const k of memCache.keys()) {
                memCache.delete(k);
                break;
            }
        }

        //кладем в таблицу
        await db.insert({
            table: 'query_cache',
            replace: true,
            rows: [{id: key, value}],
        });

        await db.insert({
            table: 'query_time',
            replace: true,
            rows: [{id: key, time: Date.now()}],
        });
    }

    async search(query) {
        if (this.closed)
            throw new Error('DbSearcher closed');

        this.searchFlag++;

        try {
            const db = this.db;

            const key = `author-ids-${this.queryKey(query)}`;

            //сначала попробуем найти в кеше
            let authorIds = await this.getCached(key);
            if (authorIds === null) {//не нашли в кеше, ищем в поисковых таблицах
                authorIds = await this.selectAuthorIds(query);

                await this.putCached(key, authorIds);
            }

            const totalFound = authorIds.length;
            let limit = (query.limit ? query.limit : 100);
            limit = (limit > 1000 ? 1000 : limit);
            const offset = (query.offset ? query.offset : 0);

            //выборка найденных авторов
            const result = await db.select({
                table: 'author',
                map: `(r) => ({id: r.id, author: r.author, bookCount: r.bookCount, bookDelCount: r.bookDelCount})`,
                where: `@@id(${db.esc(authorIds.slice(offset, offset + limit))})`
            });

            return {result, totalFound};
        } finally {
            this.searchFlag--;
        }
    }

    async getBookList(authorId) {
        if (this.closed)
            throw new Error('DbSearcher closed');

        this.searchFlag++;

        try {
            const db = this.db;

            //выборка книг автора по authorId
            const rows = await db.select({
                table: 'author_book',
                where: `@@id(${db.esc(authorId)})`
            });

            let author = '';
            let books = '';

            if (rows.length) {
                author = rows[0].author;
                books = rows[0].books;
            }

            return {author, books};
        } finally {
            this.searchFlag--;
        }
    }

    async getSeriesBookList(series) {
        if (this.closed)
            throw new Error('DbSearcher closed');

        this.searchFlag++;

        try {
            const db = this.db;

            series = series.toLowerCase();

            //выборка серии по названию серии
            let rows = await db.select({
                table: 'series',
                where: `@@dirtyIndexLR('value', ${db.esc(series)}, ${db.esc(series)})`
            });

            let books;
            if (rows.length) {
                //выборка книг серии
                rows = await db.select({
                    table: 'series_book',
                    where: `@@id(${rows[0].id})`
                });

                if (rows.length)
                    books = rows[0].books;
            }

            return {books: (books && books.length ? JSON.stringify(books) : '')};
        } finally {
            this.searchFlag--;
        }
    }

    async periodicCleanCache() {
        this.timer = null;
        const cleanInterval = this.config.cacheCleanInterval*60*1000;
        if (!cleanInterval)
            return;

        try {
            const db = this.db;

            const oldThres = Date.now() - cleanInterval;

            //выберем всех кандидатов на удаление
            const rows = await db.select({
                table: 'query_time',
                where: `
                    @@iter(@all(), (r) => (r.time < ${db.esc(oldThres)}));
                `
            });

            const ids = [];
            for (const row of rows)
                ids.push(row.id);

            //удаляем
            await db.delete({table: 'query_cache', where: `@@id(${db.esc(ids)})`});
            await db.delete({table: 'query_time', where: `@@id(${db.esc(ids)})`});
            
            //console.log('Cache clean', ids);
        } catch(e) {
            console.error(e.message);
        } finally {
            if (!this.closed) {
                this.timer = setTimeout(() => { this.periodicCleanCache(); }, cleanInterval);
            }
        }
    }

    async close() {
        while (this.searchFlag > 0) {
            await utils.sleep(50);
        }

        this.searchCache = null;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.heavyCalc.terminate();
        this.closed = true;
    }
}

module.exports = DbSearcher;