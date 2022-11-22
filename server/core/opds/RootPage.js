const BasePage = require('./BasePage');
const AuthorPage = require('./AuthorPage');

class RootPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'root';
        this.title = '';

        this.authorPage = new AuthorPage(config);
    }

    async body() {
        const result = {};

        if (!this.title) {
            const dbConfig = await this.webWorker.dbConfig();
            const collection = dbConfig.inpxInfo.collection.split('\n');
            this.title = collection[0].trim();
            if (!this.title)
                this.title = 'Неизвестная коллекция';
        }

        result.entry = [
            this.authorPage.myEntry(),
        ];

        return this.makeBody(result);
    }
}

module.exports = RootPage;