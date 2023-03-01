
using Microsoft.AspNetCore.Mvc;
using System.Data.SqlClient;

class PulseTaintTests
{
    [HttpPost]
    static void httpPostSourceToSqlSink(string inputParameter)
    {
        using var _ = new SqlCommand(inputParameter);
    }
}
