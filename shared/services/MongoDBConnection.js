/**
 * MongoDB Connection Service
 * 
 * Manages MongoDB connection for the ah-call-service database
 */

const mongoose = require('mongoose');

class MongoDBConnection {
  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI;
      
      if (!mongoUri) {
        console.error('❌ [MongoDB] MONGODB_URI environment variable is not set');
        throw new Error('MONGODB_URI environment variable is not set');
      }

      // Parse and log connection details (safely)
      const uriParts = mongoUri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)/);
      if (uriParts) {
        console.log('🔗 [MongoDB] Connection details:');
        console.log(`   Protocol: mongodb+srv`);
        console.log(`   Username: ${uriParts[1]}`);
        console.log(`   Password: ${'*'.repeat(uriParts[2].length)}`);
        console.log(`   Host: ${uriParts[3]}`);
        console.log(`   Database: ${uriParts[4]}`);
      }

      console.log('🔗 [MongoDB] Connecting to ah-call-service database...');
      console.log('⏱️  [MongoDB] Connection options:');
      console.log('   maxPoolSize: 10');
      console.log('   serverSelectionTimeoutMS: 5000');
      console.log('   socketTimeoutMS: 45000');
      
      const startTime = Date.now();
      
      // Create connection
      this.connection = await mongoose.connect(mongoUri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      const duration = Date.now() - startTime;

      this.isConnected = true;
      console.log(`✅ [MongoDB] Connected to ah-call-service database in ${duration}ms`);
      console.log(`📊 [MongoDB] Connection status:`, {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        collections: Object.keys(mongoose.connection.collections).length,
      });
      
      // Handle connection events
      mongoose.connection.on('error', (error) => {
        console.error('❌ [MongoDB] Connection error:', {
          message: error.message,
          code: error.code,
          name: error.name,
        });
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ [MongoDB] Disconnected from database');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('✅ [MongoDB] Reconnected to database');
        this.isConnected = true;
      });

      return this.connection;
      
    } catch (error) {
      console.error('❌ [MongoDB] Failed to connect:', {
        message: error.message,
        code: error.code,
        name: error.name,
        reason: error.reason,
      });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      this.isConnected = false;
      console.log('👋 [MongoDB] Disconnected');
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    };
  }
}

// Export singleton instance
module.exports = new MongoDBConnection();

