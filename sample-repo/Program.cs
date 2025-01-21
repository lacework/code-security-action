
using Microsoft.AspNetCore.Mvc;
using System.Data.SqlClient;

class PulseTaintTests
{
    [HttpPost]
    static void httpPostSourceToSqlSink(string inputParameter)
    {
        string query = "SELECT * FROM " + inputParameter;
        using var _ = new SqlCommand(query);
    }
}
