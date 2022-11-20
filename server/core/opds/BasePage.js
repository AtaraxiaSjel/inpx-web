const WebWorker = require('../WebWorker');//singleton
const XmlParser = require('../xml/XmlParser');

class BasePage {
    constructor(config) {        
        this.config = config;

        this.webWorker = new WebWorker(config);
        this.rootTag = 'feed';
        this.opdsRoot = config.opdsRoot;
    }

    makeEntry(entry = {}) {
        if (!entry.id)
            throw new Error('makeEntry: no id');
        if (!entry.title)
            throw new Error('makeEntry: no title');

        const result = {
            updated: (new Date()).toISOString().substring(0, 19) + 'Z',
        };

        return Object.assign(result, entry);
    }

    myEntry() {
        return this.makeEntry({
            id: this.id,
            title: this.title, 
            link: this.navLink({rel: 'subsection', href: `/${this.id}`}),
        });
    }

    makeLink(attrs) {
        return {'*ATTRS': attrs};
    }

    navLink(attrs) {
        return this.makeLink({
            href: this.opdsRoot + (attrs.href || ''),
            rel: attrs.rel || '',
            type: 'application/atom+xml; profile=opds-catalog; kind=navigation',
        });
    }

    baseLinks() {
        return [
            this.navLink({rel: 'start'}),
            this.navLink({rel: 'self', href: (this.id ? `/${this.id}` : '')}),
        ];
    }

    makeBody(content) {
        const base = this.makeEntry({id: this.id, title: this.title});
        base['*ATTRS'] = {
            'xmlns': 'http://www.w3.org/2005/Atom',
            'xmlns:dc': 'http://purl.org/dc/terms/',
            'xmlns:opds': 'http://opds-spec.org/2010/catalog',
        };

        if (!content.link)
            base.link = this.baseLinks();

        const xml = new XmlParser();
        const xmlObject = {};        
        xmlObject[this.rootTag] = Object.assign(base, content);

        xml.fromObject(xmlObject);

        return xml.toString({format: true});
    }

    async body() {
        throw new Error('Body not implemented');
    }
}

module.exports = BasePage;