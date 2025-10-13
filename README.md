# 📋 Contract Ride Service - Comprehensive README

## 🚀 Overview

The **Contract Ride Service** is a robust Node.js backend service for managing contract-based ride services. It handles recurring ride schedules, billing, payments, and ride logging with comprehensive role-based access control and file upload capabilities.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Express.js](https://img.shields.io/badge/Express.js-4.18%2B-lightgrey)
![MySQL](https://img.shields.io/badge/MySQL-8.0%2B-blue)
![JWT](https://img.shields.io/badge/JWT-Auth-orange)

## ✨ Features

- **🔐 Authentication & Authorization** - JWT-based stateless authentication with role-based access control
- **📝 Contract Management** - Create and manage ride contracts for individuals and organizations
- **💰 Payment Processing** - Handle payments with receipt image upload support
- **🕒 Ride Scheduling** - Manage recurring ride schedules (daily, weekly, monthly)
- **🎫 Subscription System** - Passenger subscription management with payment tracking
- **📁 File Uploads** - Support for receipt images and documents with automatic management
- **👥 Multi-Role Support** - Admin, Passenger, Driver roles with granular permissions
- **⚡ RESTful API** - Clean, well-structured REST API endpoints

## 🏗️ System Architecture

```
Client App → API Gateway → Contract Ride Service → MySQL Database
                    │
                    ├── User Service (for authentication)
                    ├── File Storage (local uploads)
                    └── External Payment Processors
```

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- MySQL 8.0+
- npm or yarn

### Step-by-Step Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd contract-ride-service
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Configuration**
Create `.env` file:
```env
# Database
DB_HOST=localhost
DB_NAME=contract_service_db
DB_USER=root
DB_PASSWORD=your_mysql_password

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# File Uploads
MAX_FILE_SIZE_MB=10
UPLOADS_FOLDER=./uploads
```

4. **Database Setup**
```bash
# The service will automatically create database and tables
npm run dev
```

5. **Verify Installation**
```bash
curl http://localhost:3000
# Should return: {"success":true,"message":"API is healthy"}
```

## 🗃️ Database Models

### Core Entities:
- **Contracts** - Master ride agreements
- **Payments** - Payment records with receipt uploads
- **Subscriptions** - Passenger subscriptions
- **RideSchedules** - Recurring ride schedules  
- **Discounts** - Contract discounts (admin only)

### Relationships:
```
Contracts (1) ────▶ (N) Payments
   │
   ├───▶ (N) Subscriptions
   │
   └───▶ (N) RideSchedules
```

## 🔐 Authentication & Authorization

### JWT Token Structure:
```json
{
  "id": 1,
  "type": "admin", // or "passenger", "driver"
  "roles": [],
  "permissions": [],
  "iat": 1756386299,
  "exp": 1756991099
}
```

### Role-Based Access Matrix:

| Resource | Endpoint | Admin | Passenger | Driver |
|----------|----------|-------|-----------|--------|
| Contracts | `GET/POST /api/contracts` | ✅ Full access | 👁️ Read own | ❌ No access |
| Payments | `GET/POST /api/payments` | ✅ Full access | ➕ Create & read own | ❌ No access |
| Subscriptions | `GET/POST /api/subscriptions` | ✅ Full access | ➕ Create & read own | ❌ No access |
| Schedules | `GET/PUT /api/schedules` | ✅ Full access | ❌ No access | 🔧 Read & update assigned |
| Discounts | `ALL /api/discounts` | ✅ Full access | ❌ No access | ❌ No access |

## 📡 API Endpoints

### Authentication Required for All Endpoints

### Contracts
- `POST /api/contracts` - Create new contract (Admin only)
- `GET /api/contracts` - Get all contracts (Admin: all, Passenger: own)
- `GET /api/contracts/:id` - Get contract by ID
- `PUT /api/contracts/:id` - Update contract (Admin only)
- `DELETE /api/contracts/:id` - Delete contract (Admin only)

### Payments
- `POST /api/payments` - Create payment with receipt upload (Admin/Passenger)
- `GET /api/payments` - Get payments (Admin: all, Passenger: own)
- `GET /api/payments/:id` - Get payment by ID
- `PUT /api/payments/:id` - Update payment (Admin only)
- `DELETE /api/payments/:id` - Delete payment (Admin only)

### Subscriptions
- `POST /api/subscriptions` - Create subscription (Admin/Passenger)
- `GET /api/subscriptions` - Get subscriptions (Admin: all, Passenger: own)
- `GET /api/subscriptions/:id` - Get subscription by ID
- `PUT /api/subscriptions/:id` - Update subscription (Admin only)
- `DELETE /api/subscriptions/:id` - Delete subscription (Admin only)

### Ride Schedules
- `POST /api/schedules` - Create ride schedule (Admin only)
- `GET /api/schedules` - Get schedules (Admin: all, Driver: assigned)
- `GET /api/schedules/:id` - Get schedule by ID
- `PUT /api/schedules/:id` - Update schedule (Admin: all, Driver: status only)
- `DELETE /api/schedules/:id` - Delete schedule (Admin only)

### Discounts
- `POST /api/discounts` - Create discount (Admin only)
- `GET /api/discounts` - Get all discounts (Admin only)
- `GET /api/discounts/:id` - Get discount by ID (Admin only)
- `PUT /api/discounts/:id` - Update discount (Admin only)
- `DELETE /api/discounts/:id` - Delete discount (Admin only)

## 📁 File Uploads

### Supported File Types:
- Images: JPEG, JPG, PNG, GIF, WebP
- Documents: PDF
- Max File Size: 10MB

### Upload Structure:
```
uploads/
├── payments/
│   └── receipt_image-1234567890.jpg
├── contracts/
│   └── document-1234567890.pdf
└── schedules/
    └── route_map-1234567890.png
```

### Example File Upload:
```javascript
// Using FormData in frontend
const formData = new FormData();
formData.append('receipt_image', fileInput.files[0]);
formData.append('contract_id', 'uuid-123');
formData.append('payment_method', 'BANK_TRANSFER');

fetch('/api/payments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-jwt-token'
  },
  body: formData
});
```

## 🧪 Testing

### Run Tests:
```bash
npm run dev
```

### Postman Collection:
Import the provided `postman.json` collection for comprehensive API testing.

### Example Test Data:
```json
{
  "contract": {
    "contract_type": "INSTITUTIONAL",
    "start_date": "2024-01-01",
    "end_date": "2024-12-31",
    "pickup_location": "Bole Airport",
    "dropoff_location": "City Center",
    "cost": 15000.00
  }
}
```

## 🚀 Deployment

### Production Environment:
```env
NODE_ENV=production
DB_HOST=production-db-host
DB_NAME=production_db
DB_USER=production_user
DB_PASSWORD=strong_password
JWT_SECRET=very_strong_secret_key
```

### Process Management (PM2):
```bash
npm install -g pm2
pm2 start index.js --name "contract-service"
pm2 save
pm2 startup
```

## 📊 Database Maintenance

### Regular Backups:
```bash
# Add to cron job
0 2 * * * mysqldump -u username -p password contract_service_db > backup_$(date +%Y%m%d).sql
```

### Optimization:
```sql
-- Regular maintenance
OPTIMIZE TABLE contracts, payments, subscriptions, ride_schedules;
```

## 🔧 Configuration

### Environment Variables:
| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | MySQL host | localhost |
| `DB_NAME` | Database name | contract_service_db |
| `DB_USER` | Database user | root |
| `DB_PASSWORD` | Database password | - |
| `JWT_SECRET` | JWT secret key | - |
| `JWT_EXPIRES_IN` | Token expiration | 7d |
| `MAX_FILE_SIZE_MB` | Max upload size | 10 |
| `UPLOADS_FOLDER` | Upload directory | ./uploads |

### Customization:
- Modify `config/dbconfig.js` for database settings
- Update `middleware/auth.js` for authentication rules
- Adjust `utils/multerUploader.js` for file upload settings

## 🆘 Troubleshooting

### Common Issues:

1. **Database Connection Issues**
   ```bash
   # Check MySQL service
   sudo systemctl status mysql
   ```

2. **File Upload Errors**
   - Check uploads directory permissions
   - Verify file size limits

3. **JWT Token Issues**
   - Verify JWT_SECRET is set
   - Check token expiration

4. **CORS Issues**
   - Configure CORS in your server setup

### Debug Mode:
```bash
# Enable detailed logging
DEBUG=* npm run dev
```

## 📈 Monitoring & Logging

### Health Checks:
```bash
curl http://localhost:3000/api/health
```

### Log Files:
- Application logs: `logs/app.log`
- Access logs: `logs/access.log`
- Error logs: `logs/error.log`

### Performance Monitoring:
```bash
# Install monitoring tools
npm install -g clinic
clinic doctor -- node index.js
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Setup:
```bash
# Install dev dependencies
npm install --include=dev

# Run with auto-reload
npm run dev

# Run tests
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏢 Enterprise Features

- **🔒 Role-Based Access Control** - Granular permissions system
- **📊 Audit Logging** - Comprehensive activity tracking
- **⚡ Performance Optimization** - Database indexing and query optimization
- **🔐 Security Hardening** - Input validation, SQL injection protection
- **📱 Mobile Ready** - RESTful API optimized for mobile clients

## 🌟 Advanced Features

- **Recurring Billing** - Automated subscription payments
- **Real-time Notifications** - WebSocket support for live updates
- **Geo-spatial Queries** - Location-based ride matching
- **Multi-language Support** - Internationalization ready
- **API Rate Limiting** - Request throttling and protection

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Maintainer**: Contract Ride Service Team  
**Support**: support@contractrideservice.com

## 🚀 Getting Started Quick Guide

1. **Install & Setup**
   ```bash
   git clone <repo>
   npm install
   cp .env.example .env
   # Edit .env with your settings
   npm run dev
   ```

2. **Test the API**
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/contracts
   ```

3. **Import Postman Collection**
   - Import `postman.json` into Postman
   - Set environment variables in Postman
   - Start testing endpoints

4. **Deploy to Production**
   ```bash
   npm run run
   npm run run:production
   ```

For detailed documentation, check our [API Docs](https://docs.contractrideservice.com).

---

*Built with ❤️ using Node.js, Express, MySQL, and JWT Authentication*