import Sequelize from 'sequelize';
import databaseConfig from '../config/database';
import user from '../app/models/User';
import file from '../app/models/File';

const models = [user, file];

class Database {
    constructor() {
        this.init();
    }

    init() {
        this.connection = new Sequelize(databaseConfig);

        models
            .map(model => model.init(this.connection))
            .map(
                model =>
                    model.associate && model.associate(this.connection.models)
            );
    }
}

export default new Database();
